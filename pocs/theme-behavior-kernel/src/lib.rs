use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet, VecDeque};
use std::ops::{Add, Div, Mul, Neg, Sub};

pub mod measurement;
pub mod output;

const EPSILON: f64 = 1.0e-9;

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(from = "[f64; 3]", into = "[f64; 3]")]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vec3 {
    pub const UP: Self = Self {
        x: 0.0,
        y: 1.0,
        z: 0.0,
    };

    pub const fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }

    pub fn dot(self, other: Self) -> f64 {
        self.x * other.x + self.y * other.y + self.z * other.z
    }

    pub fn cross(self, other: Self) -> Self {
        Self::new(
            self.y * other.z - self.z * other.y,
            self.z * other.x - self.x * other.z,
            self.x * other.y - self.y * other.x,
        )
    }

    pub fn length(self) -> f64 {
        self.dot(self).sqrt()
    }

    pub fn normalize_or(self, fallback: Self) -> Self {
        let length = self.length();
        if length > EPSILON {
            self / length
        } else {
            fallback
        }
    }

    pub fn distance(self, other: Self) -> f64 {
        (self - other).length()
    }

    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite()
    }
}

impl From<[f64; 3]> for Vec3 {
    fn from(value: [f64; 3]) -> Self {
        Self::new(value[0], value[1], value[2])
    }
}

impl From<Vec3> for [f64; 3] {
    fn from(value: Vec3) -> Self {
        [value.x, value.y, value.z]
    }
}

impl Add for Vec3 {
    type Output = Self;

    fn add(self, rhs: Self) -> Self::Output {
        Self::new(self.x + rhs.x, self.y + rhs.y, self.z + rhs.z)
    }
}

impl Sub for Vec3 {
    type Output = Self;

    fn sub(self, rhs: Self) -> Self::Output {
        Self::new(self.x - rhs.x, self.y - rhs.y, self.z - rhs.z)
    }
}

impl Mul<f64> for Vec3 {
    type Output = Self;

    fn mul(self, rhs: f64) -> Self::Output {
        Self::new(self.x * rhs, self.y * rhs, self.z * rhs)
    }
}

impl Div<f64> for Vec3 {
    type Output = Self;

    fn div(self, rhs: f64) -> Self::Output {
        Self::new(self.x / rhs, self.y / rhs, self.z / rhs)
    }
}

impl Neg for Vec3 {
    type Output = Self;

    fn neg(self) -> Self::Output {
        Self::new(-self.x, -self.y, -self.z)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelConfig {
    pub schema_version: u32,
    pub fixed_dt_seconds: f64,
    pub max_catch_up_steps: u32,
    pub speed_units_per_second: f64,
    pub reference_ticks: [u64; 8],
    pub path: PathConfig,
    pub camera: CameraConfig,
    pub entities: Vec<EntityConfig>,
}

impl KernelConfig {
    pub fn from_json(input: &str) -> Result<Self, String> {
        let config: Self = serde_json::from_str(input).map_err(|error| error.to_string())?;
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err(format!(
                "unsupported schema_version {}",
                self.schema_version
            ));
        }
        require_positive("fixed_dt_seconds", self.fixed_dt_seconds)?;
        require_positive("speed_units_per_second", self.speed_units_per_second)?;
        if self.reference_ticks[0] != 0
            || self
                .reference_ticks
                .windows(2)
                .any(|pair| pair[0] >= pair[1])
        {
            return Err(
                "reference_ticks must contain eight strictly increasing ticks starting at 0".into(),
            );
        }
        if self.max_catch_up_steps == 0 || self.max_catch_up_steps > 16 {
            return Err("max_catch_up_steps must be in 1..=16".into());
        }
        if !self.path.closed {
            return Err("the proof requires a closed path".into());
        }
        if self.path.control_points.len() < 4 {
            return Err("a closed Catmull-Rom path requires at least four points".into());
        }
        if self.path.samples_per_segment < 8 || self.path.samples_per_segment > 512 {
            return Err("samples_per_segment must be in 8..=512".into());
        }
        if self
            .path
            .control_points
            .iter()
            .any(|point| !point.is_finite())
        {
            return Err("path points must be finite".into());
        }
        if self.entities.is_empty() || self.entities.len() > 64 {
            return Err("entities must contain 1..=64 entries".into());
        }
        let mut instance_ids = HashSet::new();
        let mut session_ids = HashSet::new();
        for entity in &self.entities {
            if entity.instance_id.trim().is_empty() || entity.session_id.trim().is_empty() {
                return Err("entity identifiers must not be empty".into());
            }
            if !instance_ids.insert(&entity.instance_id) {
                return Err(format!("duplicate instance_id {}", entity.instance_id));
            }
            if !session_ids.insert(&entity.session_id) {
                return Err(format!("duplicate session_id {}", entity.session_id));
            }
            if !entity.longitudinal_offset.is_finite() || !entity.lateral_offset.is_finite() {
                return Err(format!(
                    "entity {} has a non-finite offset",
                    entity.instance_id
                ));
            }
        }
        self.camera.validate()
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PathConfig {
    pub closed: bool,
    pub samples_per_segment: u32,
    pub control_points: Vec<Vec3>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EntityConfig {
    pub instance_id: String,
    pub session_id: String,
    pub longitudinal_offset: f64,
    pub lateral_offset: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CameraConfig {
    pub aspect_ratio: f64,
    pub fov_y_degrees: f64,
    pub safe_fraction_x: f64,
    pub safe_fraction_y: f64,
    pub min_distance: f64,
    pub max_distance: f64,
    pub height_ratio: f64,
    pub max_translation_per_second: f64,
}

impl CameraConfig {
    fn validate(&self) -> Result<(), String> {
        require_positive("camera.aspect_ratio", self.aspect_ratio)?;
        require_positive("camera.min_distance", self.min_distance)?;
        require_positive("camera.max_distance", self.max_distance)?;
        require_positive(
            "camera.max_translation_per_second",
            self.max_translation_per_second,
        )?;
        if !(10.0..=100.0).contains(&self.fov_y_degrees) {
            return Err("camera.fov_y_degrees must be in 10..=100".into());
        }
        if !(0.1..=1.0).contains(&self.safe_fraction_x)
            || !(0.1..=1.0).contains(&self.safe_fraction_y)
        {
            return Err("camera safe fractions must be in 0.1..=1.0".into());
        }
        if self.min_distance > self.max_distance {
            return Err("camera.min_distance must not exceed max_distance".into());
        }
        if !self.height_ratio.is_finite() || !(0.0..=2.0).contains(&self.height_ratio) {
            return Err("camera.height_ratio must be in 0..=2".into());
        }
        Ok(())
    }
}

fn require_positive(name: &str, value: f64) -> Result<(), String> {
    if value.is_finite() && value > 0.0 {
        Ok(())
    } else {
        Err(format!("{name} must be finite and positive"))
    }
}

#[derive(Clone, Copy, Debug)]
struct ArcSample {
    distance: f64,
    segment: usize,
    t: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PathPose {
    pub position: Vec3,
    pub tangent: Vec3,
}

#[derive(Clone, Debug)]
pub struct ClosedPath {
    points: Vec<Vec3>,
    arc_samples: Vec<ArcSample>,
    total_length: f64,
}

impl ClosedPath {
    pub fn compile(config: &PathConfig) -> Result<Self, String> {
        if !config.closed || config.control_points.len() < 4 {
            return Err("closed path requires at least four control points".into());
        }
        if config.samples_per_segment < 8 {
            return Err("path sampling is too coarse".into());
        }

        let mut arc_samples = Vec::new();
        let mut distance = 0.0;
        let mut previous = catmull_rom(&config.control_points, 0, 0.0).0;
        arc_samples.push(ArcSample {
            distance,
            segment: 0,
            t: 0.0,
        });

        for segment in 0..config.control_points.len() {
            for sample in 1..=config.samples_per_segment {
                let t = f64::from(sample) / f64::from(config.samples_per_segment);
                let position = catmull_rom(&config.control_points, segment, t).0;
                distance += previous.distance(position);
                arc_samples.push(ArcSample {
                    distance,
                    segment,
                    t,
                });
                previous = position;
            }
        }

        if !distance.is_finite() || distance <= EPSILON {
            return Err("path has no measurable length".into());
        }
        Ok(Self {
            points: config.control_points.clone(),
            arc_samples,
            total_length: distance,
        })
    }

    pub fn total_length(&self) -> f64 {
        self.total_length
    }

    pub fn sample_distance(&self, distance: f64) -> PathPose {
        let wrapped = distance.rem_euclid(self.total_length);
        let upper = self
            .arc_samples
            .partition_point(|sample| sample.distance <= wrapped)
            .min(self.arc_samples.len() - 1);
        let lower = upper.saturating_sub(1);
        let a = self.arc_samples[lower];
        let b = self.arc_samples[upper];
        let span = b.distance - a.distance;
        let fraction = if span > EPSILON {
            (wrapped - a.distance) / span
        } else {
            0.0
        };

        let (segment, t) = if a.segment == b.segment {
            (a.segment, a.t + (b.t - a.t) * fraction)
        } else {
            (b.segment, b.t * fraction)
        };
        let (position, derivative) = catmull_rom(&self.points, segment, t);
        PathPose {
            position,
            tangent: derivative.normalize_or(Vec3::new(0.0, 0.0, 1.0)),
        }
    }
}

fn catmull_rom(points: &[Vec3], segment: usize, t: f64) -> (Vec3, Vec3) {
    let count = points.len();
    let p0 = points[(segment + count - 1) % count];
    let p1 = points[segment % count];
    let p2 = points[(segment + 1) % count];
    let p3 = points[(segment + 2) % count];
    let t2 = t * t;
    let t3 = t2 * t;

    let position = (p1 * 2.0
        + (p2 - p0) * t
        + (p0 * 2.0 - p1 * 5.0 + p2 * 4.0 - p3) * t2
        + (-p0 + p1 * 3.0 - p2 * 3.0 + p3) * t3)
        * 0.5;
    let derivative = ((p2 - p0)
        + (p0 * 4.0 - p1 * 10.0 + p2 * 8.0 - p3 * 2.0) * t
        + (-p0 * 3.0 + p1 * 9.0 - p2 * 9.0 + p3 * 3.0) * t2)
        * 0.5;
    (position, derivative)
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct EntitySnapshot {
    pub instance_id: String,
    pub session_id: String,
    pub path_distance: f64,
    pub position: Vec3,
    pub forward: Vec3,
    pub activity: ActivityState,
    pub authority: MotionAuthority,
    pub roll_degrees: f64,
    pub suspension_offset: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityState {
    Idle,
    Active,
    Busy,
    Success,
    Error,
    Recovering,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionPresence {
    Disconnected,
    Present,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum SessionEvent {
    Connected {
        event_id: String,
        session_id: String,
        sequence: u64,
    },
    Activity {
        event_id: String,
        session_id: String,
        sequence: u64,
        state: ActivityState,
    },
    Disconnected {
        event_id: String,
        session_id: String,
        sequence: u64,
    },
}

impl SessionEvent {
    fn parts(&self) -> (&str, &str, u64) {
        match self {
            Self::Connected {
                event_id,
                session_id,
                sequence,
            }
            | Self::Activity {
                event_id,
                session_id,
                sequence,
                ..
            }
            | Self::Disconnected {
                event_id,
                session_id,
                sequence,
            } => (event_id, session_id, *sequence),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum SessionIntent {
    Focus { session_id: String },
    Open { session_id: String },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SessionSnapshot {
    pub session_id: String,
    pub presence: SessionPresence,
    pub activity: ActivityState,
    pub connection_epoch: u64,
    pub last_sequence: u64,
}

#[derive(Debug)]
pub struct SessionSimulator {
    sessions: BTreeMap<String, SessionSnapshot>,
    handled_events: HashSet<String>,
}

impl SessionSimulator {
    pub fn new(session_ids: impl IntoIterator<Item = String>) -> Result<Self, String> {
        let mut sessions = BTreeMap::new();
        for session_id in session_ids {
            if session_id.is_empty() || sessions.contains_key(&session_id) {
                return Err("session simulator requires unique non-empty identities".into());
            }
            sessions.insert(
                session_id.clone(),
                SessionSnapshot {
                    session_id,
                    presence: SessionPresence::Disconnected,
                    activity: ActivityState::Idle,
                    connection_epoch: 0,
                    last_sequence: 0,
                },
            );
        }
        if sessions.is_empty() || sessions.len() > 64 {
            return Err("session simulator requires 1..=64 identities".into());
        }
        Ok(Self {
            sessions,
            handled_events: HashSet::new(),
        })
    }

    pub fn apply(&mut self, event: &SessionEvent) -> Result<bool, String> {
        let (event_id, session_id, sequence) = event.parts();
        if event_id.is_empty() || event_id.len() > 96 {
            return Err("session event id must contain 1..=96 characters".into());
        }
        if self.handled_events.contains(event_id) {
            return Ok(false);
        }
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("unknown session_id {session_id}"))?;
        if sequence <= session.last_sequence {
            return Err("session event sequence must increase".into());
        }
        match event {
            SessionEvent::Connected { .. } => {
                if session.presence == SessionPresence::Disconnected {
                    session.connection_epoch += 1;
                }
                session.presence = SessionPresence::Present;
                session.activity = ActivityState::Idle;
            }
            SessionEvent::Activity { state, .. } => {
                if session.presence != SessionPresence::Present {
                    return Err("activity requires a present session".into());
                }
                session.activity = *state;
            }
            SessionEvent::Disconnected { .. } => {
                session.presence = SessionPresence::Disconnected;
                session.activity = ActivityState::Recovering;
            }
        }
        session.last_sequence = sequence;
        self.handled_events.insert(event_id.to_owned());
        Ok(true)
    }

    pub fn snapshots(&self) -> Vec<SessionSnapshot> {
        self.sessions.values().cloned().collect()
    }

    pub fn intent(&self, intent: &SessionIntent) -> Result<SessionSnapshot, String> {
        let session_id = match intent {
            SessionIntent::Focus { session_id } | SessionIntent::Open { session_id } => session_id,
        };
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("unknown session_id {session_id}"))?;
        if session.presence != SessionPresence::Present {
            return Err("session intent requires a present session".into());
        }
        Ok(session.clone())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MotionAuthority {
    Route,
    Recovery,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EffectKind {
    Particles,
    Sprite,
    Sound,
    Material,
    CameraImpulse,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ActiveEffect {
    pub event_id: String,
    pub session_id: String,
    pub kind: EffectKind,
    pub expires_at_tick: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CameraSnapshot {
    pub eye: Vec3,
    pub target: Vec3,
    pub up: Vec3,
    pub fov_y_degrees: f64,
    pub aspect_ratio: f64,
    pub safe_fraction_x: f64,
    pub safe_fraction_y: f64,
}

impl CameraSnapshot {
    pub fn project_to_ndc(&self, point: Vec3) -> Option<[f64; 2]> {
        let forward = (self.target - self.eye).normalize_or(Vec3::new(0.0, 0.0, 1.0));
        let right = forward
            .cross(self.up)
            .normalize_or(Vec3::new(1.0, 0.0, 0.0));
        let up = right.cross(forward).normalize_or(Vec3::UP);
        let relative = point - self.eye;
        let depth = relative.dot(forward);
        if depth <= EPSILON {
            return None;
        }
        let tan_half_y = (self.fov_y_degrees.to_radians() * 0.5).tan();
        Some([
            relative.dot(right) / (depth * tan_half_y * self.aspect_ratio),
            relative.dot(up) / (depth * tan_half_y),
        ])
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PresentationSnapshot {
    pub tick: u64,
    pub simulation_seconds: f64,
    pub group_distance: f64,
    pub entities: Vec<EntitySnapshot>,
    pub camera: CameraSnapshot,
    pub effects: Vec<ActiveEffect>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct RuntimeCounters {
    pub simulation_steps: u64,
    pub elapsed_updates: u64,
    pub catch_up_clamps: u64,
    pub pause_transitions: u64,
    pub occlusion_transitions: u64,
    pub render_submissions: Option<u64>,
    pub gpu_submissions: Option<u64>,
    pub allocation_events: Option<u64>,
    pub pacing_misses: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ReferenceCheckpoint {
    pub tick: u64,
    pub snapshot_sha256: String,
}

pub fn snapshot_sha256(snapshot: &PresentationSnapshot) -> String {
    let bytes = serde_json::to_vec(snapshot).expect("serializable presentation snapshot");
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

#[derive(Clone, Debug)]
struct CameraDirector {
    config: CameraConfig,
    previous: Option<CameraSnapshot>,
}

impl CameraDirector {
    fn new(config: CameraConfig) -> Self {
        Self {
            config,
            previous: None,
        }
    }

    fn update(&mut self, anchors: &[Vec3], forward: Vec3, dt: f64) -> CameraSnapshot {
        let center = anchors.iter().copied().fold(Vec3::default(), Add::add) / anchors.len() as f64;
        let radius = anchors
            .iter()
            .map(|anchor| anchor.distance(center))
            .fold(0.0, f64::max)
            .max(0.5);

        let tan_half_y = (self.config.fov_y_degrees.to_radians() * 0.5).tan();
        let safe_tan_y = tan_half_y * self.config.safe_fraction_y * 0.82;
        let safe_tan_x = tan_half_y * self.config.aspect_ratio * self.config.safe_fraction_x * 0.82;
        let limiting_angle = safe_tan_x.min(safe_tan_y).atan();
        let distance = (radius / limiting_angle.sin())
            .clamp(self.config.min_distance, self.config.max_distance);
        let horizontal = Vec3::new(forward.x, 0.0, forward.z).normalize_or(forward);
        let desired = CameraSnapshot {
            eye: center - horizontal * distance + Vec3::UP * (distance * self.config.height_ratio),
            target: center,
            up: Vec3::UP,
            fov_y_degrees: self.config.fov_y_degrees,
            aspect_ratio: self.config.aspect_ratio,
            safe_fraction_x: self.config.safe_fraction_x,
            safe_fraction_y: self.config.safe_fraction_y,
        };

        let Some(previous) = &self.previous else {
            self.previous = Some(desired.clone());
            return desired;
        };
        let max_delta = self.config.max_translation_per_second * dt;
        let result = CameraSnapshot {
            eye: move_toward(previous.eye, desired.eye, max_delta),
            target: move_toward(previous.target, desired.target, max_delta),
            ..desired
        };
        self.previous = Some(result.clone());
        result
    }
}

fn move_toward(current: Vec3, target: Vec3, max_delta: f64) -> Vec3 {
    let delta = target - current;
    let distance = delta.length();
    if distance <= max_delta || distance <= EPSILON {
        target
    } else {
        current + delta * (max_delta / distance)
    }
}

#[derive(Debug)]
pub struct BehaviorKernel {
    config: KernelConfig,
    path: ClosedPath,
    camera: CameraDirector,
    tick: u64,
    group_distance: f64,
    accumulator: f64,
    paused: bool,
    occluded: bool,
    counters: RuntimeCounters,
    activity: BTreeMap<String, ActivityState>,
    authorities: BTreeMap<String, u64>,
    effects: VecDeque<ActiveEffect>,
    handled_events: HashSet<String>,
    snapshot: PresentationSnapshot,
}

impl BehaviorKernel {
    pub fn new(config: KernelConfig) -> Result<Self, String> {
        config.validate()?;
        let path = ClosedPath::compile(&config.path)?;
        let camera = CameraDirector::new(config.camera.clone());
        let placeholder_camera = CameraSnapshot {
            eye: Vec3::default(),
            target: Vec3::default(),
            up: Vec3::UP,
            fov_y_degrees: config.camera.fov_y_degrees,
            aspect_ratio: config.camera.aspect_ratio,
            safe_fraction_x: config.camera.safe_fraction_x,
            safe_fraction_y: config.camera.safe_fraction_y,
        };
        let activity = config
            .entities
            .iter()
            .map(|entity| (entity.session_id.clone(), ActivityState::Idle))
            .collect();
        let mut kernel = Self {
            config,
            path,
            camera,
            tick: 0,
            group_distance: 0.0,
            accumulator: 0.0,
            paused: false,
            occluded: false,
            counters: RuntimeCounters::default(),
            activity,
            authorities: BTreeMap::new(),
            effects: VecDeque::new(),
            handled_events: HashSet::new(),
            snapshot: PresentationSnapshot {
                tick: 0,
                simulation_seconds: 0.0,
                group_distance: 0.0,
                entities: Vec::new(),
                camera: placeholder_camera,
                effects: Vec::new(),
            },
        };
        kernel.rebuild_snapshot();
        Ok(kernel)
    }

    pub fn fixed_dt_seconds(&self) -> f64 {
        self.config.fixed_dt_seconds
    }

    pub fn path_length(&self) -> f64 {
        self.path.total_length()
    }

    pub fn snapshot(&self) -> &PresentationSnapshot {
        &self.snapshot
    }

    pub fn counters(&self) -> &RuntimeCounters {
        &self.counters
    }

    pub fn reference_ticks(&self) -> [u64; 8] {
        self.config.reference_ticks
    }

    pub fn set_paused(&mut self, paused: bool) {
        if self.paused != paused {
            self.counters.pause_transitions += 1;
        }
        self.paused = paused;
        if !paused {
            self.accumulator = 0.0;
        }
    }

    pub fn set_occluded(&mut self, occluded: bool) {
        if self.occluded != occluded {
            self.counters.occlusion_transitions += 1;
        }
        self.occluded = occluded;
        self.set_paused(occluded);
    }

    pub fn apply_activity(
        &mut self,
        event_id: &str,
        session_id: &str,
        state: ActivityState,
    ) -> Result<bool, String> {
        if event_id.is_empty() || event_id.len() > 96 {
            return Err("event_id must contain 1..=96 characters".into());
        }
        if self.handled_events.contains(event_id) {
            return Ok(false);
        }
        let activity = self
            .activity
            .get_mut(session_id)
            .ok_or_else(|| format!("unknown session_id {session_id}"))?;
        *activity = state;
        self.handled_events.insert(event_id.to_owned());
        let kind = match state {
            ActivityState::Idle | ActivityState::Active => None,
            ActivityState::Busy => Some(EffectKind::Particles),
            ActivityState::Success => Some(EffectKind::Sprite),
            ActivityState::Error => Some(EffectKind::Material),
            ActivityState::Recovering => Some(EffectKind::CameraImpulse),
        };
        if let Some(kind) = kind {
            if self.effects.len() == 64 {
                self.effects.pop_front();
            }
            self.effects.push_back(ActiveEffect {
                event_id: event_id.to_owned(),
                session_id: session_id.to_owned(),
                kind,
                expires_at_tick: self.tick + 30,
            });
        }
        self.rebuild_snapshot();
        Ok(true)
    }

    pub fn take_recovery_control(
        &mut self,
        instance_id: &str,
        duration_ticks: u64,
    ) -> Result<(), String> {
        if !(1..=300).contains(&duration_ticks)
            || !self
                .config
                .entities
                .iter()
                .any(|entity| entity.instance_id == instance_id)
        {
            return Err("recovery requires a known instance and 1..=300 ticks".into());
        }
        self.authorities
            .insert(instance_id.to_owned(), self.tick + duration_ticks);
        self.rebuild_snapshot();
        Ok(())
    }

    pub fn tick_fixed(&mut self) -> &PresentationSnapshot {
        if self.paused {
            return &self.snapshot;
        }
        self.tick += 1;
        self.counters.simulation_steps += 1;
        self.group_distance = (self.group_distance
            + self.config.speed_units_per_second * self.config.fixed_dt_seconds)
            .rem_euclid(self.path.total_length());
        self.effects
            .retain(|effect| effect.expires_at_tick > self.tick);
        self.authorities.retain(|_, until| *until > self.tick);
        self.rebuild_snapshot();
        &self.snapshot
    }

    pub fn advance_elapsed(&mut self, elapsed_seconds: f64) -> u32 {
        if self.paused || !elapsed_seconds.is_finite() || elapsed_seconds <= 0.0 {
            return 0;
        }
        self.counters.elapsed_updates += 1;
        let maximum = self.config.fixed_dt_seconds * f64::from(self.config.max_catch_up_steps);
        if elapsed_seconds > maximum {
            self.counters.catch_up_clamps += 1;
        }
        self.accumulator += elapsed_seconds.min(maximum);
        let mut steps = 0;
        while self.accumulator + EPSILON >= self.config.fixed_dt_seconds
            && steps < self.config.max_catch_up_steps
        {
            self.accumulator -= self.config.fixed_dt_seconds;
            self.tick_fixed();
            steps += 1;
        }
        steps
    }

    fn rebuild_snapshot(&mut self) {
        let entities = self
            .config
            .entities
            .iter()
            .map(|entity| {
                let distance = (self.group_distance - entity.longitudinal_offset)
                    .rem_euclid(self.path.total_length());
                let pose = self.path.sample_distance(distance);
                let right = Vec3::UP
                    .cross(pose.tangent)
                    .normalize_or(Vec3::new(1.0, 0.0, 0.0));
                EntitySnapshot {
                    instance_id: entity.instance_id.clone(),
                    session_id: entity.session_id.clone(),
                    path_distance: distance,
                    position: pose.position + right * entity.lateral_offset,
                    forward: pose.tangent,
                    activity: self.activity[&entity.session_id],
                    authority: if self.authorities.contains_key(&entity.instance_id) {
                        MotionAuthority::Recovery
                    } else {
                        MotionAuthority::Route
                    },
                    roll_degrees: if matches!(
                        self.activity[&entity.session_id],
                        ActivityState::Active | ActivityState::Busy
                    ) {
                        (distance * 0.15).sin() * 4.0
                    } else {
                        0.0
                    },
                    suspension_offset: if self.activity[&entity.session_id] == ActivityState::Busy {
                        (distance * 0.4).sin() * 0.04
                    } else {
                        0.0
                    },
                }
            })
            .collect::<Vec<_>>();
        let group_forward = self.path.sample_distance(self.group_distance).tangent;
        let anchors = entities
            .iter()
            .map(|entity| entity.position)
            .collect::<Vec<_>>();
        let camera = self
            .camera
            .update(&anchors, group_forward, self.config.fixed_dt_seconds);
        self.snapshot = PresentationSnapshot {
            tick: self.tick,
            simulation_seconds: self.tick as f64 * self.config.fixed_dt_seconds,
            group_distance: self.group_distance,
            entities,
            camera,
            effects: self.effects.iter().cloned().collect(),
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> KernelConfig {
        KernelConfig::from_json(include_str!("../fixtures/eight-karts.json")).unwrap()
    }

    #[test]
    fn fixture_loads_eight_distinct_instances_and_sessions() {
        let config = fixture();
        assert_eq!(config.entities.len(), 8);
        assert_eq!(
            config
                .entities
                .iter()
                .map(|entity| &entity.instance_id)
                .collect::<HashSet<_>>()
                .len(),
            8
        );
        assert_eq!(
            config
                .entities
                .iter()
                .map(|entity| &entity.session_id)
                .collect::<HashSet<_>>()
                .len(),
            8
        );
    }

    #[test]
    fn duplicate_identity_is_rejected() {
        let mut config = fixture();
        config.entities[1].instance_id = config.entities[0].instance_id.clone();
        assert!(
            config
                .validate()
                .unwrap_err()
                .contains("duplicate instance_id")
        );
    }

    #[test]
    fn loop_seam_preserves_position_and_tangent() {
        let path = ClosedPath::compile(&fixture().path).unwrap();
        let start = path.sample_distance(0.0);
        let end = path.sample_distance(path.total_length());
        assert!(start.position.distance(end.position) < 1.0e-10);
        assert!(start.tangent.distance(end.tangent) < 1.0e-10);
    }

    #[test]
    fn same_inputs_produce_identical_snapshots() {
        let mut first = BehaviorKernel::new(fixture()).unwrap();
        let mut second = BehaviorKernel::new(fixture()).unwrap();
        for _ in 0..2_000 {
            assert_eq!(first.tick_fixed(), second.tick_fixed());
        }
    }

    #[test]
    fn formation_keeps_order_and_finite_transforms_over_two_loops() {
        let mut kernel = BehaviorKernel::new(fixture()).unwrap();
        let expected_ids = kernel
            .snapshot()
            .entities
            .iter()
            .map(|entity| entity.instance_id.clone())
            .collect::<Vec<_>>();
        let ticks = (kernel.path_length() * 2.0
            / (kernel.config.speed_units_per_second * kernel.fixed_dt_seconds()))
        .ceil() as usize;
        for _ in 0..ticks {
            let snapshot = kernel.tick_fixed();
            assert_eq!(
                snapshot
                    .entities
                    .iter()
                    .map(|entity| entity.instance_id.clone())
                    .collect::<Vec<_>>(),
                expected_ids
            );
            assert!(snapshot.entities.iter().all(|entity| {
                entity.position.is_finite()
                    && entity.forward.is_finite()
                    && (entity.forward.length() - 1.0).abs() < 1.0e-9
            }));
        }
    }

    #[test]
    fn camera_motion_is_bounded_and_group_stays_in_safe_area() {
        let config = fixture();
        let maximum_delta =
            config.camera.max_translation_per_second * config.fixed_dt_seconds + 1.0e-9;
        let mut kernel = BehaviorKernel::new(config).unwrap();
        let mut previous_eye = kernel.snapshot().camera.eye;
        for _ in 0..1_500 {
            let snapshot = kernel.tick_fixed();
            assert!(snapshot.camera.eye.distance(previous_eye) <= maximum_delta);
            for entity in &snapshot.entities {
                let ndc = snapshot.camera.project_to_ndc(entity.position).unwrap();
                assert!(ndc[0].abs() <= snapshot.camera.safe_fraction_x + 1.0e-8);
                assert!(ndc[1].abs() <= snapshot.camera.safe_fraction_y + 1.0e-8);
            }
            previous_eye = snapshot.camera.eye;
        }
    }

    #[test]
    fn pause_and_resume_do_not_replay_unbounded_elapsed_time() {
        let mut kernel = BehaviorKernel::new(fixture()).unwrap();
        kernel.tick_fixed();
        let before_pause = kernel.snapshot().clone();
        kernel.set_paused(true);
        assert_eq!(kernel.advance_elapsed(60.0), 0);
        assert_eq!(kernel.snapshot(), &before_pause);

        kernel.set_paused(false);
        let steps = kernel.advance_elapsed(60.0);
        assert_eq!(steps, kernel.config.max_catch_up_steps);
        assert_eq!(kernel.snapshot().tick, before_pause.tick + u64::from(steps));
        assert_eq!(kernel.counters().catch_up_clamps, 1);
        assert_eq!(kernel.counters().pause_transitions, 2);
    }

    #[test]
    fn eight_reference_checkpoints_are_stable() {
        let mut first = BehaviorKernel::new(fixture()).unwrap();
        let mut second = BehaviorKernel::new(fixture()).unwrap();
        let ticks = first.reference_ticks();
        let mut first_hashes = Vec::new();
        let mut second_hashes = Vec::new();
        for target in ticks {
            while first.snapshot().tick < target {
                first.tick_fixed();
            }
            while second.snapshot().tick < target {
                second.tick_fixed();
            }
            first_hashes.push(snapshot_sha256(first.snapshot()));
            second_hashes.push(snapshot_sha256(second.snapshot()));
        }
        assert_eq!(first_hashes.len(), 8);
        assert_eq!(first_hashes, second_hashes);
    }

    #[test]
    fn occlusion_stops_simulation_and_counts_transitions() {
        let mut kernel = BehaviorKernel::new(fixture()).unwrap();
        kernel.set_occluded(true);
        let frozen = kernel.snapshot().clone();
        assert_eq!(kernel.advance_elapsed(1.0), 0);
        assert_eq!(kernel.tick_fixed(), &frozen);
        kernel.set_occluded(false);
        kernel.tick_fixed();
        assert_eq!(kernel.counters().occlusion_transitions, 2);
        assert_eq!(kernel.counters().pause_transitions, 2);
    }

    #[test]
    fn activity_effects_are_bounded_deduplicated_and_pause_with_time() {
        let mut kernel = BehaviorKernel::new(fixture()).unwrap();
        assert!(
            kernel
                .apply_activity("event.1", "session.01", ActivityState::Busy)
                .unwrap()
        );
        assert!(
            !kernel
                .apply_activity("event.1", "session.01", ActivityState::Error)
                .unwrap()
        );
        assert_eq!(kernel.snapshot().effects.len(), 1);
        assert_eq!(kernel.snapshot().entities[0].activity, ActivityState::Busy);
        kernel.set_occluded(true);
        for _ in 0..100 {
            kernel.tick_fixed();
        }
        assert_eq!(kernel.snapshot().effects.len(), 1);
        kernel.set_occluded(false);
        for _ in 0..30 {
            kernel.tick_fixed();
        }
        assert!(kernel.snapshot().effects.is_empty());
    }

    #[test]
    fn recovery_authority_returns_explicitly_to_route() {
        let mut kernel = BehaviorKernel::new(fixture()).unwrap();
        kernel.take_recovery_control("kart.01", 3).unwrap();
        assert_eq!(
            kernel.snapshot().entities[0].authority,
            MotionAuthority::Recovery
        );
        kernel.tick_fixed();
        kernel.tick_fixed();
        assert_eq!(
            kernel.snapshot().entities[0].authority,
            MotionAuthority::Recovery
        );
        kernel.tick_fixed();
        assert_eq!(
            kernel.snapshot().entities[0].authority,
            MotionAuthority::Route
        );
    }

    #[test]
    fn session_simulator_proves_activity_error_recovery_and_reconnection() {
        let mut simulator = SessionSimulator::new(["session.01".to_owned()]).unwrap();
        let events = [
            SessionEvent::Connected {
                event_id: "e1".into(),
                session_id: "session.01".into(),
                sequence: 1,
            },
            SessionEvent::Activity {
                event_id: "e2".into(),
                session_id: "session.01".into(),
                sequence: 2,
                state: ActivityState::Active,
            },
            SessionEvent::Activity {
                event_id: "e3".into(),
                session_id: "session.01".into(),
                sequence: 3,
                state: ActivityState::Error,
            },
            SessionEvent::Disconnected {
                event_id: "e4".into(),
                session_id: "session.01".into(),
                sequence: 4,
            },
            SessionEvent::Connected {
                event_id: "e5".into(),
                session_id: "session.01".into(),
                sequence: 5,
            },
        ];
        for event in &events {
            assert!(simulator.apply(event).unwrap());
        }
        assert!(!simulator.apply(&events[4]).unwrap());
        let snapshot = simulator
            .intent(&SessionIntent::Focus {
                session_id: "session.01".into(),
            })
            .unwrap();
        assert_eq!(snapshot.presence, SessionPresence::Present);
        assert_eq!(snapshot.activity, ActivityState::Idle);
        assert_eq!(snapshot.connection_epoch, 2);
    }
}
