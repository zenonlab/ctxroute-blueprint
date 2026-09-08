import AppKit
import QuartzCore
#if SWIFT_PACKAGE
import ThemeModel
#endif

/// One persistent tree per WallpaperID. No NSWindow and no frame timer.
@MainActor public final class Scene {
    public let root = CALayer()
    private let theme: Theme
    private let background = CAGradientLayer()
    private let ring = CAShapeLayer()
    private let motion = CALayer()
    private var dots: [CALayer] = []
    private var controls: [CATextLayer] = []
    private var animationStart: Double = 0
    private var previousSize = CGSize.zero
    private var previousScale: CGFloat = 0
    public private(set) var updates = 0
    public init(theme: Theme) {
        self.theme = theme
        root.addSublayer(background); root.addSublayer(ring); root.addSublayer(motion)
        background.colors = [Self.color(theme.background), Self.color(theme.accent).copy(alpha: 0.22) ?? Self.color(theme.accent)]
        root.backgroundColor = Self.color(theme.background)
        background.startPoint = CGPoint(x: 0, y: 0); background.endPoint = CGPoint(x: 1, y: 1)
        ring.fillColor = nil; ring.strokeColor = Self.color(theme.accent).copy(alpha: 0.2)
        ring.lineWidth = 2
        for object in theme.objects {
            let dot = CALayer(); dot.name = object.id
            let size = object.size ?? 44
            dot.backgroundColor = Self.color(object.color); dot.cornerRadius = size / 2
            dot.bounds = CGRect(x: 0, y: 0, width: size, height: size)
            let label = CATextLayer(); label.string = object.label ?? ">_"
            label.fontSize = object.label == nil ? 15 : 10; label.alignmentMode = .center
            label.foregroundColor = Self.color("101B30"); label.truncationMode = .end
            label.frame = CGRect(x: 2, y: size / 2 - 8, width: size - 4, height: 18)
            label.contentsScale = 2; dot.addSublayer(label)
            motion.addSublayer(dot); dots.append(dot)
        }
        for item in theme.system_controls.items {
            let control = CATextLayer(); control.name = "control.\(item)"
            control.string = item == "audio" ? "Son coupé" : item == "desktop" ? "Fichiers…" : item
            control.fontSize = 13; control.alignmentMode = .center
            control.foregroundColor = Self.color("FFFFFF")
            control.backgroundColor = Self.color("18283F"); control.cornerRadius = 10
            control.borderWidth = 1; control.borderColor = Self.color(theme.accent).copy(alpha: 0.5)
            root.addSublayer(control); controls.append(control)
        }
    }
    public func resize(_ size: CGSize, scale: CGFloat = 2, initialElapsed: Double? = nil) {
        guard size != previousSize || scale != previousScale else { return }
        let elapsed = initialElapsed ?? (previousSize == .zero ? 0 : max(0, motion.convertTime(CACurrentMediaTime(), from: nil) - animationStart))
        previousSize = size; previousScale = scale; updates += 1
        CATransaction.begin(); CATransaction.setDisableActions(true)
        root.frame = CGRect(origin: .zero, size: size); root.contentsScale = scale
        background.frame = root.bounds; motion.frame = root.bounds; ring.frame = root.bounds
        for (index, control) in controls.enumerated() {
            let rect = ThemeLayout.control(index)
            control.frame = CGRect(x: rect.x, y: size.height - rect.y - rect.height, width: rect.width, height: rect.height)
            control.contentsScale = scale
        }
        let orbit = CGRect(x: size.width * 0.2, y: size.height * 0.24,
                           width: size.width * 0.6, height: size.height * 0.52)
        ring.path = theme.motion_path == "wave" ? nil : CGPath(ellipseIn: orbit, transform: nil)
        animationStart = motion.convertTime(CACurrentMediaTime(), from: nil) - elapsed
        for (index, dot) in dots.enumerated() {
            let object = theme.objects[index]
            dot.sublayers?.forEach { $0.contentsScale = scale }
            let samples = (0...128).map { step -> NSValue in
                let p = ThemeLayout.position(object, theme: theme, width: size.width, height: size.height,
                    elapsed: Double(step) / 128 * theme.period_seconds)
                return NSValue(point: CGPoint(x: p.x, y: size.height - p.y))
            }
            dot.position = samples[0].pointValue
            if theme.motion_path == "still" || object.x != nil { continue }
            let animation = CAKeyframeAnimation(keyPath: "position")
            animation.values = samples; animation.duration = theme.period_seconds
            animation.repeatCount = .infinity; animation.beginTime = animationStart
            animation.calculationMode = .linear; animation.isRemovedOnCompletion = false
            animation.preferredFrameRateRange = CAFrameRateRange(minimum: 15, maximum: 30, preferred: 30)
            dot.add(animation, forKey: "orbit")
        }
        CATransaction.commit()
    }
    public func apply(_ state: ThemeState, suspended: Bool = false) {
        let paused = state.paused || suspended
        CATransaction.begin(); CATransaction.setDisableActions(true)
        if paused && motion.speed != 0 {
            let time = motion.convertTime(CACurrentMediaTime(), from: nil)
            motion.speed = 0; motion.timeOffset = time
        } else if !paused && motion.speed == 0 {
            let time = motion.timeOffset
            motion.speed = 1; motion.timeOffset = 0; motion.beginTime = 0
            motion.beginTime = motion.convertTime(CACurrentMediaTime(), from: nil) - time
        }
        ring.lineWidth = state.highlighted ? 5 : 2
        for dot in dots {
            dot.borderColor = Self.color("FFFFFF"); dot.borderWidth = state.highlighted ? 3 : 0
        }
        ring.strokeColor = Self.color(theme.accent).copy(alpha: state.highlighted ? 0.85 : 0.2)
        for control in controls where control.name == "control.audio" {
            control.string = state.muted ? "Son coupé" : "Son activé"
        }
        CATransaction.commit(); updates += 1
    }
    public func layout(id: UUID, display: UInt32?, interactive: Bool) -> SurfaceLayout {
        let now = CACurrentMediaTime()
        return SurfaceLayout(id: id, theme: theme.theme_id, display: display,
            width: root.bounds.width, height: root.bounds.height, capturedAt: now,
            elapsed: max(0, motion.convertTime(now, from: nil) - animationStart),
            running: motion.speed != 0, interactive: interactive)
    }
    public var isPaused: Bool { motion.speed == 0 }
    public var objectIDs: [String] { dots.compactMap(\.name) }
    public var hasObjectAnimations: Bool { dots.contains { !($0.animationKeys() ?? []).isEmpty } }
    public static func color(_ hex: String) -> CGColor {
        let value = UInt32(hex, radix: 16) ?? 0
        return CGColor(red: CGFloat((value >> 16) & 255) / 255,
                       green: CGFloat((value >> 8) & 255) / 255,
                       blue: CGFloat(value & 255) / 255, alpha: 1)
    }
}
