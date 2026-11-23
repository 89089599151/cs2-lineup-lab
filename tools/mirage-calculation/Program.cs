using System.Diagnostics;
using System.IO.Compression;
using System.Numerics;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using SmokeSolver.Sim;

if (args.Length != 4)
{
    Console.Error.WriteLine("Usage: MirageCalculation <CS2 install> <fresh solver extract folder> <seed atlas.json.gz> <output.json>");
    return 1;
}

const float maximumFlightSeconds = 6.5f;
const int maximumBounces = 5;
var timer = Stopwatch.StartNew();
var game = Path.GetFullPath(args[0]);
var extracted = Path.GetFullPath(args[1]);
var seedPath = Path.GetFullPath(args[2]);
var output = Path.GetFullPath(args[3]);
var mapPath = Path.Combine(game, "game", "csgo", "maps", "de_mirage.vpk");
var buildText = File.ReadAllText(Path.Combine(game, "..", "..", "appmanifest_730.acf"));
var gameBuild = Regex.Match(buildText, @"""buildid""\s+""(\d+)""").Groups[1].Value;
var engineText = File.ReadAllText(Path.Combine(game, "game", "csgo", "steam.inf"));
var clientBuild = Regex.Match(engineText, @"(?m)^ClientVersion=(\d+)").Groups[1].Value;
var geometryPath = Path.Combine(extracted, "de_mirage.s2geo");
var navPath = Path.Combine(extracted, "de_mirage.nav");
var mesh = CollisionMesh.Load(geometryPath);
if (gameBuild.Length == 0 || clientBuild != mesh.GameBuildId || mesh.MapName != "de_mirage")
{
    throw new InvalidDataException("Mirage extraction and the installed CS2 build must match.");
}

using var seedFile = File.OpenRead(seedPath);
using var inflated = new GZipStream(seedFile, CompressionMode.Decompress);
using var seedDoc = JsonDocument.Parse(inflated);
var seed = seedDoc.RootElement;
if (seed.GetProperty("map").GetString() != mesh.MapName || seed.GetProperty("build").GetString() != clientBuild)
{
    throw new InvalidDataException("The seed atlas belongs to another map or client build.");
}
var teamLabels = seed.GetProperty("teams").EnumerateArray()
    .Select(value => value.GetString() ?? "").ToList();
var origins = seed.GetProperty("origins").EnumerateArray()
    .Select(row => new Vector3(row[0].GetSingle(), row[1].GetSingle(), row[2].GetSingle())).ToList();
var seeds = Enumerable.Range(0, origins.Count).Select(_ => new List<Aim>()).ToList();
if (teamLabels.Count != origins.Count || teamLabels.Any(team => team is not ("T" or "CT")))
{
    throw new InvalidDataException("The seed atlas must have one T or CT label per origin.");
}
foreach (var row in seed.GetProperty("rows").EnumerateArray())
{
    seeds[row[0].GetInt32()].Add(new Aim(row[1].GetSingle(), row[2].GetSingle(), row[3].GetInt32(), row[4].GetSingle()));
}
var nativeAreas = JsonSerializer.Deserialize<NavArea[]>(
    File.ReadAllText(Path.Combine(extracted, "de_mirage.navareas.json"))) ?? [];
if (nativeAreas.Length == 0) throw new InvalidDataException("The Mirage navigation mesh is missing.");
var nav = new NavSurface(nativeAreas);
var (min, max) = mesh.ComputeBounds();
var grenade = new TriangleCollider(mesh, min, max, mesh.GrenadeSolidFilter());
var player = new TriangleCollider(mesh, min, max, mesh.PlayerSolidFilter());
var types = new[] { ThrowType.Stand, ThrowType.JumpThrow };
var hull = new Vector3(2);
var anchor = FindStandingFeet(1279, -15, -162) ?? throw new InvalidDataException("T Spawn test location is not standable.");
var anchorIndex = origins.Count;
origins.Add(anchor);
teamLabels.Add("T");
var namedAnchorAims = new (float Pitch, float Yaw, int Kind, Vector3 Target)[]
{
    (-39.689972f, -166.97086f, 1, new(-1163, -635, -166)),
    (-62.85991f, -131.84438f, 0, new(475, -900, -160)),
    (-39.759945f, 172.84543f, 1, new(-1219, 231, -167)),
    (-48.11992f, -157.83969f, 1, new(-621, -897, -246)),
};
seeds.Add(SweepAnchor().Concat(namedAnchorAims.SelectMany(aim => SweepTarget(aim.Pitch, aim.Yaw, aim.Kind))).Distinct().ToList());

Console.WriteLine($"Mirage {gameBuild}/{clientBuild}: {mesh.TriangleCount:N0} triangles, {nativeAreas.Length:N0} nav areas, {seeds.Sum(list => list.Count):N0} seeded launches.");
Console.WriteLine($"T Spawn anchor: {anchor.X:F3}, {anchor.Y:F3}, {anchor.Z:F3}");
var selected = new List<Flight>[origins.Count];
var checkedFeet = new Vector3[origins.Count];
var playable = 0;
var nominalPass = 0;
var stabilityPass = 0;
var offNav = 0;
var completed = 0;
var testOffsets = new[] { (-.35f, -.35f), (-.35f, .35f), (.35f, -.35f), (.35f, .35f) };

Parallel.For(0, origins.Count, new ParallelOptions { MaxDegreeOfParallelism = Math.Max(1, Environment.ProcessorCount - 2) }, index =>
{
    var candidates = new Dictionary<(int X, int Y, int Z, int Kind), Flight>();
    var oldOrigin = origins[index];
    var currentOrigin = FindStandingFeet(oldOrigin.X, oldOrigin.Y, oldOrigin.Z);
    if (currentOrigin is null)
    {
        selected[index] = [];
        return;
    }
    var foot = currentOrigin.Value;
    Interlocked.Increment(ref playable);
    int nominalCount = 0, stableCount = 0, offNavCount = 0;
    foreach (var aim in seeds[index])
    {
        var flight = Replay(foot, aim);
        if (!IsPractical(foot, flight)) continue;
        if (!nav.IsNear(flight.RestPoint, 16, 24))
        {
            offNavCount++;
            continue;
        }
        nominalCount++;
        float worst = 0;
        bool stable = true;
        foreach (var (pitchOffset, yawOffset) in testOffsets)
        {
            var neighbor = Replay(foot, aim with { Pitch = aim.Pitch + pitchOffset, Yaw = aim.Yaw + yawOffset });
            var delta = neighbor.RestPoint - flight.RestPoint;
            if (!IsPractical(foot, neighbor) || MathF.Abs(delta.Z) > 16 || new Vector2(delta.X, delta.Y).Length() > 52
                || !nav.IsNear(neighbor.RestPoint, 16, 24))
            {
                stable = false;
                break;
            }
            worst = MathF.Max(worst, delta.Length());
        }
        if (!stable) continue;
        stableCount++;
        var rest = flight.RestPoint;
        var cell = ((int)MathF.Round(rest.X / 88), (int)MathF.Round(rest.Y / 88), (int)MathF.Round(rest.Z / 64), aim.Kind);
        var score = worst * .027f + flight.FlightTime + flight.Bounces * .28f;
        if (index == anchorIndex)
        {
            var targetDistance = namedAnchorAims.Min(target => Vector3.Distance(rest, target.Target));
            if (targetDistance < 112) score -= 5 + (112 - targetDistance) * .08f;
        }
        if (!candidates.TryGetValue(cell, out var previous) || score < previous.Score)
        {
            candidates[cell] = new Flight(aim, flight, score);
        }
    }
    checkedFeet[index] = foot;
    selected[index] = candidates.OrderBy(pair => pair.Key).Select(pair => pair.Value).ToList();
    Interlocked.Add(ref nominalPass, nominalCount);
    Interlocked.Add(ref stabilityPass, stableCount);
    Interlocked.Add(ref offNav, offNavCount);
    var done = Interlocked.Increment(ref completed);
    if (done % 50 == 0) Console.WriteLine($"Checked {done} standable origins in {timer.Elapsed.TotalSeconds:F1}s.");
});

var locations = new List<Vector3>();
var teams = new List<string>();
var rows = new List<double[]>();
var publicAnchor = -1;
for (var index = 0; index < origins.Count; index++)
{
    if (selected[index].Count == 0) continue;
    var newIndex = locations.Count;
    if (index == anchorIndex) publicAnchor = newIndex;
    locations.Add(checkedFeet[index]);
    teams.Add(teamLabels[index]);
    foreach (var flight in selected[index])
    {
        var aim = flight.Aim;
        var f = flight.Result;
        rows.Add([newIndex, Round(aim.Pitch, 4), Round(aim.Yaw, 4), aim.Kind, aim.Strength,
            Round(f.RestPoint.X, 2), Round(f.RestPoint.Y, 2), Round(f.RestPoint.Z, 2), Round(f.FlightTime, 2), f.Bounces]);
    }
}

if (publicAnchor < 0) throw new InvalidDataException("The T Spawn test origin has no stable candidates.");
var anchorRows = selected[anchorIndex].Count;
var data = new
{
    map = mesh.MapName,
    gameBuild,
    origins = locations.Select(foot => Coordinates(foot, 4)).ToArray(),
    teams,
    kinds = new [] { "stand", "jump" },
    rows,
    metadata = new
    {
        source = "installed CS2 Mirage VPK, exact offline simulation",
        solver = "NC1107/cs2-smoke-solver@7ebba5b",
        clientBuild,
        vpkSha256 = Digest(mapPath),
        navSha256 = Digest(navPath),
        geometrySha256 = Digest(geometryPath),
        seedSha256 = Digest(seedPath),
        triangles = mesh.TriangleCount,
        navAreas = nativeAreas.Length,
        hullHalfExtent = 2,
        maxPitchYawPerturbation = .35,
        maxPerturbationHorizontalDelta = 52,
        maxPerturbationVerticalDelta = 16,
        maxHorizontalDistanceToNav = 16,
        maxVerticalDistanceToNav = 24,
        maxFlightTime = maximumFlightSeconds,
        maxBounces = maximumBounces,
        minimumThrowDistance = 96,
        originProbeRadius = 24,
        testedOrigins = origins.Count,
        standableOrigins = playable,
        nominalPass,
        stabilityPass,
        offNav,
        startAnchorIndex = publicAnchor,
        startAnchorRows = anchorRows,
    },
};
var tempFile = output + "." + Guid.NewGuid().ToString("N") + ".tmp";
try
{
    using (var stream = File.Create(tempFile)) JsonSerializer.Serialize(stream, data);
    File.Move(tempFile, output, overwrite: true);
}
finally
{
    if (File.Exists(tempFile)) File.Delete(tempFile);
}
Console.WriteLine($"Retained {rows.Count:N0} rows from {locations.Count:N0} origins, {anchorRows:N0} from the exact T Spawn anchor, in {timer.Elapsed.TotalSeconds:F1}s.");
Console.WriteLine($"Native nav rejected {offNav:N0} nominal practical flights; aim stability retained {stabilityPass:N0}/{nominalPass:N0} before deduplication.");

foreach (var (rawOrigin, aim) in new[]
{
    (new Vector3(-1686.625f, -1147.745f, -188), new Aim(-50, 90, 1, 1)),
    (new Vector3(-1686.625f, -1147.745f, -188), new Aim(-50, 90, 1, .5f)),
    (new Vector3(1422.8f, 36.437f, -167.969f), new Aim(-30, -150, 1, 1)),
})
{
    var feet = FindStandingFeet(rawOrigin.X, rawOrigin.Y, rawOrigin.Z) ?? rawOrigin;
    var flight = Replay(feet, aim);
    Console.WriteLine($"Audit {rawOrigin}: {aim.Pitch}/{aim.Yaw} p={aim.Strength} -> {flight.RestPoint}; "
        + $"flight={flight.FlightTime:F2}s, bounces={flight.Bounces}, nearNav={nav.IsNear(flight.RestPoint, 16, 24)}, "
        + $"practical={IsPractical(feet, flight)}");
}
Console.WriteLine("Exact T Spawn target proposals:");
foreach (var (pitch, yaw, kind, _) in namedAnchorAims)
{
    var specified = new Aim(pitch, yaw, kind, 1);
    var f = Replay(anchor, specified);
    var near = nav.IsNear(f.RestPoint, 16, 24);
    var outcomes = testOffsets.Select(offset => Replay(anchor, specified with { Pitch = pitch + offset.Item1, Yaw = yaw + offset.Item2 }));
    Console.WriteLine($"  {pitch:F4}/{yaw:F4} -> {f.RestPoint}; flight={f.FlightTime:F2}s, bounces={f.Bounces}, nearNav={near}, lost={f.Lost}. "
        + $"Perturbations: {string.Join(" / ", outcomes.Select(n => $"{n.RestPoint} {n.FlightTime:F2}s {n.Bounces}b"))}");
}
return 0;

Vector3? FindStandingFeet(float x, float y, float hint)
{
    if (!nav.IsNear(new Vector3(x, y, hint), 16, 24)) return null;
    var from = new Vector3(x, y, hint + 24);
    var to = new Vector3(x, y, hint - 24);
    if (player.FirstHit(from, to) is not { } hit || hit.Normal.Z < .65f) return null;
    var point = Vector3.Lerp(from, to, hit.T);
    if (!nav.IsNear(point, 16, 24) || player.BoxIntersects(point + new Vector3(0, 0, 36.4f), new Vector3(15.5f, 15.5f, 35.8f))) return null;
    return point;
}

TrajectoryResult Replay(Vector3 foot, Aim aim)
{
    var type = types[aim.Kind];
    var eye = foot + new Vector3(0, 0, GrenadeTrajectory.EyeHeight(type));
    var (launch, velocity) = GrenadeTrajectory.DeriveInitial(new ThrowSpec(eye, aim.Yaw, aim.Pitch, type, aim.Strength));
    var releaseEye = eye with { Z = launch.Z };
    if (grenade.BoxIntersects(launch, hull)
        || grenade.FirstHitHull(releaseEye, launch, hull) is not null)
    {
        return new TrajectoryResult(Vector3.Zero, 0, 0, true);
    }
    return GrenadeTrajectory.SimulateExactRaw(grenade, launch, velocity);
}

static bool IsPractical(Vector3 foot, TrajectoryResult flight) =>
    !flight.Lost && flight.FlightTime is > .3f and <= maximumFlightSeconds && flight.Bounces <= maximumBounces && flight.GlassBreaks == 0
    && Vector3.DistanceSquared(foot, flight.RestPoint) >= 96 * 96;

static IEnumerable<Aim> SweepAnchor()
{
    for (var kind = 0; kind < 2; kind++)
    {
        foreach (var strength in new[] { 1f, .5f, 0f })
        for (var yaw = -180; yaw < 180; yaw += 3)
        for (var pitch = -86; pitch <= 30; pitch += 2)
            yield return new Aim(pitch, yaw, kind, strength);
    }
}

static IEnumerable<Aim> SweepTarget(float pitch, float yaw, int kind)
{
    for (var p = -20; p <= 20; p++)
    for (var y = -24; y <= 24; y++)
        yield return new Aim(pitch + .5f * p, WrapYaw(yaw + .5f * y), kind, 1f);
}

static float WrapYaw(float yaw) => yaw > 180 ? yaw - 360 : yaw < -180 ? yaw + 360 : yaw;

static double Round(float value, int digits) => Math.Round((double)value, digits);
static double[] Coordinates(Vector3 point, int digits) => [Round(point.X, digits), Round(point.Y, digits), Round(point.Z, digits)];
static string Digest(string path)
{
    using var file = File.OpenRead(path);
    return Convert.ToHexStringLower(SHA256.HashData(file));
}

record struct Aim(float Pitch, float Yaw, int Kind, float Strength);
record struct Flight(Aim Aim, TrajectoryResult Result, float Score);
record NavArea(uint Id, float[][] Corners);

sealed class NavSurface
{
    private const int Cell = 96;
    private readonly Dictionary<(int, int), List<Vector3[]>> cells = new();

    public NavSurface(IEnumerable<NavArea> areas)
    {
        foreach (var area in areas)
        {
            var c = area.Corners.Select(p => new Vector3(p[0], p[1], p[2])).ToArray();
            if (c.Length < 3) continue;
            for (var x = Bucket(c.Min(p => p.X)); x <= Bucket(c.Max(p => p.X)); x++)
            for (var y = Bucket(c.Min(p => p.Y)); y <= Bucket(c.Max(p => p.Y)); y++)
            {
                if (!cells.TryGetValue((x, y), out var nearby)) cells[(x, y)] = nearby = [];
                nearby.Add(c);
            }
        }
    }

    public bool IsNear(Vector3 point, float horizontalTolerance, float verticalTolerance)
    {
        var toleranceSquared = horizontalTolerance * horizontalTolerance;
        for (var x = Bucket(point.X - horizontalTolerance); x <= Bucket(point.X + horizontalTolerance); x++)
        for (var y = Bucket(point.Y - horizontalTolerance); y <= Bucket(point.Y + horizontalTolerance); y++)
        {
            if (!cells.TryGetValue((x, y), out var areas)) continue;
            foreach (var c in areas)
            {
                for (var i = 1; i < c.Length - 1; i++)
                {
                    if (GetTriangleZ(point, c[0], c[i], c[i + 1]) is { } z && MathF.Abs(point.Z - z) <= verticalTolerance)
                        return true;
                }
                for (var i = 0; i < c.Length; i++)
                {
                    var origin = c[i];
                    var end = c[(i + 1) % c.Length];
                    var delta = end - origin;
                    var lengthSquared = delta.X * delta.X + delta.Y * delta.Y;
                    if (lengthSquared == 0) continue;
                    var fraction = Math.Clamp(((point.X - origin.X) * delta.X + (point.Y - origin.Y) * delta.Y) / lengthSquared, 0, 1);
                    var close = origin + delta * fraction;
                    var dx = point.X - close.X;
                    var dy = point.Y - close.Y;
                    if (dx * dx + dy * dy <= toleranceSquared && MathF.Abs(point.Z - close.Z) <= verticalTolerance)
                        return true;
                }
            }
        }
        return false;
    }

    private static int Bucket(float v) => (int)MathF.Floor(v / Cell);

    private static float? GetTriangleZ(Vector3 point, Vector3 a, Vector3 b, Vector3 c)
    {
        var u = b - a;
        var v = c - a;
        var p = point - a;
        var det = u.X * v.Y - u.Y * v.X;
        if (MathF.Abs(det) < 1e-4f) return null;
        var s = (p.X * v.Y - p.Y * v.X) / det;
        var t = (u.X * p.Y - u.Y * p.X) / det;
        return s >= 0 && t >= 0 && s + t <= 1f ? a.Z + s * u.Z + t * v.Z : null;
    }
}
