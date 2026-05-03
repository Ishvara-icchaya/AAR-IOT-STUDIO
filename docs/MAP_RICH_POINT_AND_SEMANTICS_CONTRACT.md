# Map transport and scrubber semantics (locked contract)

**Principle:** `RuntimeMapPoint` and `RichMapPoint` are map transport; `SemanticRow` plus the resolution ladder is the authority for display strings. Sync never overwrites saved semantics without `wouldOverwriteSaved` and an explicit merge.

## Transport types

### `RuntimeMapPoint` (live / latest only)

```ts
type RuntimeMapPoint = {
  latestDeviceStateId: string;
  resolvedDeviceId: string;
  endpointId: string;
  lng: number;
  lat: number;
  headingDeg?: number;
  label?: string; // resolved after semantic ladder
};
```

### `RichMapPoint` (scrubbed history: Historical, Trace, Replay)

```ts
type RichMapPoint = {
  scrubbedEventId: string;
  resolvedDeviceId: string;
  endpointId: string;
  eventTs: string;
  ingestedAt?: string;

  lng: number;
  lat: number;
  headingDeg?: number;
  label?: string;

  health?: unknown;
  kpi?: unknown;
  display?: unknown;

  source: "historical" | "trace" | "replay";
};
```

## Mode behavior

| Mode        | Purpose                                      |
|------------|-----------------------------------------------|
| Runtime    | Current position and live KPIs              |
| Historical | Inspect past points (sparse / sampled)     |
| Trace      | Ordered static path for one device/window   |
| Replay     | Animated movement over ordered points     |

## Hit test (RichMapPoint)

- **Radius:** CSS pixels (primary pick = nearest screen distance).
- **Tie-break 1:** nearest `event_ts`.
- **Tie-break 2:** `scrubbed_event_id`.

Do not infer identity from lat/lon alone (multiple events can share a pixel).

## Marker stabilization (refresh)

- No auto-fit on refresh (only first load, binding change, or explicit user action).
- No marker z-order change on refresh.
- No label anchor change on refresh.
- **Static devices:** ~1–2 m threshold before updating rendered position.
- **Dynamic devices:** ~5 m threshold; smooth only meaningful movement.
- Use accuracy/HDOP later if available.

## Map load instrumentation (targets)

Log or metrics fields (names indicative):

- `site_id`, `mode`, `binding_fingerprint`
- `marker_count`, `marker_bytes`
- `api_total_ms`, `redis_ms`, `db_ms`, `serialization_ms`, `client_render_ms`, `deck_layer_ms`

Profile before speculative optimization (e.g. viewport/bbox, lighter DTOs, cache per site).

## Scrubber semantics — `SemanticRow`

```ts
type SemanticRow = {
  scrubberId: string;
  versionId: string;
  attributePath: string;
  semanticType?: "identity" | "timestamp" | "location" | "health" | "kpi" | "label";
  displayName?: string; // user-visible name for this mapping in Studio (not the runtime value)
  source: "saved" | "synced";
};
```

- Use **`displayName`** for Studio chrome; avoid using **`label`** as both semantic type name and value.
- **Semantic type `label`:** display-only; not identity; does not replace `resolved_device_id`.

### Sync API

- Sync **appends** newly discovered attributes.
- Sync **does not** mutate saved semantic mappings.
- Response flag: **`wouldOverwriteSaved: boolean`** — explicit merge required when true.

## Label resolution order (runtime string on map / tables)

1. Semantic **label** value (from mapped attribute)
2. `device_label`
3. `object_name`
4. `resolved_device_id`
5. `device_id`

---

*This document is the agreed cross-cutting contract for parallel workstreams: map intelligence (Rich/Runtime points, trace, replay, stabilization, instrumentation) and scrubber semantics (save/sync, `label` semantic, `wouldOverwriteSaved`).*
