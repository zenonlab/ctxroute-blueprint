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
    private var previousSize = CGSize.zero
    private var previousScale: CGFloat = 0
    public private(set) var updates = 0
    public init(theme: Theme) {
        self.theme = theme
        root.addSublayer(background); root.addSublayer(ring); root.addSublayer(motion)
        background.colors = [Self.color(theme.background), Self.color("233856")]
        background.startPoint = CGPoint(x: 0, y: 0); background.endPoint = CGPoint(x: 1, y: 1)
        ring.fillColor = nil; ring.strokeColor = Self.color(theme.accent).copy(alpha: 0.2)
        ring.lineWidth = 2
        for object in theme.objects {
            let dot = CALayer(); dot.name = object.id
            dot.backgroundColor = Self.color(object.color); dot.cornerRadius = 12
            dot.bounds = CGRect(x: 0, y: 0, width: 24, height: 24)
            motion.addSublayer(dot); dots.append(dot)
        }
    }
    public func resize(_ size: CGSize, scale: CGFloat = 2) {
        guard size != previousSize || scale != previousScale else { return }
        previousSize = size; previousScale = scale; updates += 1
        CATransaction.begin(); CATransaction.setDisableActions(true)
        root.frame = CGRect(origin: .zero, size: size); root.contentsScale = scale
        background.frame = root.bounds; motion.frame = root.bounds; ring.frame = root.bounds
        let orbit = CGRect(x: size.width * 0.2, y: size.height * 0.24,
                           width: size.width * 0.6, height: size.height * 0.52)
        ring.path = CGPath(ellipseIn: orbit, transform: nil)
        for (index, dot) in dots.enumerated() {
            let phase = theme.objects[index].phase
            let samples = (0...128).map { step -> NSValue in
                let angle = (Double(step) / 128 + phase) * 2 * Double.pi
                return NSValue(point: CGPoint(x: orbit.midX + cos(angle) * orbit.width / 2,
                                               y: orbit.midY + sin(angle) * orbit.height / 2))
            }
            dot.position = samples[0].pointValue
            let animation = CAKeyframeAnimation(keyPath: "position")
            animation.values = samples; animation.duration = theme.period_seconds
            animation.repeatCount = .infinity; animation.beginTime = 0
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
        ring.strokeColor = Self.color(theme.accent).copy(alpha: state.highlighted ? 0.85 : 0.2)
        CATransaction.commit(); updates += 1
    }
    public var isPaused: Bool { motion.speed == 0 }
    public var objectIDs: [String] { dots.compactMap(\.name) }
    public static func color(_ hex: String) -> CGColor {
        let value = UInt32(hex, radix: 16) ?? 0
        return CGColor(red: CGFloat((value >> 16) & 255) / 255,
                       green: CGFloat((value >> 8) & 255) / 255,
                       blue: CGFloat(value & 255) / 255, alpha: 1)
    }
}
