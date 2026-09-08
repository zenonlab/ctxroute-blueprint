import AppKit
import QuartzCore
#if SWIFT_PACKAGE
import ThemeModel
#endif

/// One persistent tree per WallpaperID. No NSWindow and no frame timer.
@MainActor public final class Scene {
    private enum ControlIcon { case volumeMuted, volume, desktopUnknown, desktopVisible, desktopHidden }
    public let root = CALayer()
    private let theme: Theme
    private let background = CAGradientLayer()
    private let ring = CAShapeLayer()
    private let motion = CALayer()
    private var dots: [CALayer] = []
    private var controls: [CALayer] = []
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
            let control = CALayer(); control.name = "control.\(item)"
            control.backgroundColor = Self.color("18283F").copy(alpha: 0.92); control.cornerRadius = 6
            control.borderWidth = 1; control.borderColor = Self.color("FFFFFF").copy(alpha: 0.16)
            let icon = CAShapeLayer(); icon.name = item == "audio" ? "lucide.volume-x" : "lucide.monitor"
            icon.path = Self.controlIcon(item == "audio" ? .volumeMuted : .desktopUnknown)
            icon.fillColor = nil; icon.strokeColor = Self.color("FFFFFF")
            icon.lineWidth = 2; icon.lineCap = .round; icon.lineJoin = .round
            icon.frame = CGRect(x: 8, y: 8, width: 24, height: 24)
            control.addSublayer(icon)
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
            control.sublayers?.forEach { $0.contentsScale = scale }
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
            if let icon = control.sublayers?.first as? CAShapeLayer {
                icon.name = state.muted ? "lucide.volume-x" : "lucide.volume-2"
                icon.path = Self.controlIcon(state.muted ? .volumeMuted : .volume)
            }
        }
        for control in controls where control.name == "control.desktop" {
            if let icon = control.sublayers?.first as? CAShapeLayer {
                switch state.desktopItemsVisible {
                case true:
                    icon.name = "lucide.eye"
                    icon.path = Self.controlIcon(.desktopVisible)
                case false:
                    icon.name = "lucide.eye-off"
                    icon.path = Self.controlIcon(.desktopHidden)
                case nil:
                    icon.name = "lucide.monitor"
                    icon.path = Self.controlIcon(.desktopUnknown)
                }
            }
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
    /// Native path adaptation of Lucide 0.468.0 volume-x, volume-2, eye,
    /// eye-off and monitor.
    /// See Packaging/Lucide-LICENSE. No browser, font icon or per-frame image decode.
    private static func controlIcon(_ kind: ControlIcon) -> CGPath {
        let path = CGMutablePath()
        if kind == .volumeMuted || kind == .volume {
            path.move(to: CGPoint(x: 11, y: 4.702))
            path.addQuadCurve(to: CGPoint(x: 9.797, y: 4.204), control: CGPoint(x: 11, y: 3.706))
            path.addLine(to: CGPoint(x: 6.413, y: 7.587))
            path.addQuadCurve(to: CGPoint(x: 5.416, y: 8), control: CGPoint(x: 6, y: 8))
            path.addLine(to: CGPoint(x: 3, y: 8))
            path.addQuadCurve(to: CGPoint(x: 2, y: 9), control: CGPoint(x: 2, y: 8))
            path.addLine(to: CGPoint(x: 2, y: 15))
            path.addQuadCurve(to: CGPoint(x: 3, y: 16), control: CGPoint(x: 2, y: 16))
            path.addLine(to: CGPoint(x: 5.416, y: 16))
            path.addQuadCurve(to: CGPoint(x: 6.413, y: 16.413), control: CGPoint(x: 6, y: 16))
            path.addLine(to: CGPoint(x: 9.797, y: 19.797))
            path.addQuadCurve(to: CGPoint(x: 11, y: 19.298), control: CGPoint(x: 11, y: 20.295))
            path.closeSubpath()
            if kind == .volumeMuted {
                path.move(to: CGPoint(x: 22, y: 9)); path.addLine(to: CGPoint(x: 16, y: 15))
                path.move(to: CGPoint(x: 16, y: 9)); path.addLine(to: CGPoint(x: 22, y: 15))
            } else {
                path.move(to: CGPoint(x: 16, y: 9))
                path.addArc(center: CGPoint(x: 12, y: 12), radius: 5,
                    startAngle: -atan2(3, 4), endAngle: atan2(3, 4), clockwise: false,
                    transform: .identity)
                path.move(to: CGPoint(x: 19.364, y: 18.364))
                path.addArc(center: CGPoint(x: 13, y: 12), radius: 9,
                    startAngle: .pi / 4, endAngle: -.pi / 4, clockwise: true)
            }
        } else if kind == .desktopUnknown {
            path.addRoundedRect(in: CGRect(x: 2, y: 3, width: 20, height: 14), cornerWidth: 2, cornerHeight: 2)
            path.move(to: CGPoint(x: 12, y: 17)); path.addLine(to: CGPoint(x: 12, y: 21))
            path.move(to: CGPoint(x: 8, y: 21)); path.addLine(to: CGPoint(x: 16, y: 21))
        } else {
            path.move(to: CGPoint(x: 2, y: 12))
            path.addCurve(to: CGPoint(x: 12, y: 5), control1: CGPoint(x: 4.5, y: 7), control2: CGPoint(x: 7.8, y: 5))
            path.addCurve(to: CGPoint(x: 22, y: 12), control1: CGPoint(x: 16.2, y: 5), control2: CGPoint(x: 19.5, y: 7))
            path.addCurve(to: CGPoint(x: 12, y: 19), control1: CGPoint(x: 19.5, y: 17), control2: CGPoint(x: 16.2, y: 19))
            path.addCurve(to: CGPoint(x: 2, y: 12), control1: CGPoint(x: 7.8, y: 19), control2: CGPoint(x: 4.5, y: 17))
            path.closeSubpath()
            path.addEllipse(in: CGRect(x: 9, y: 9, width: 6, height: 6))
            if kind == .desktopHidden {
                path.move(to: CGPoint(x: 3, y: 3)); path.addLine(to: CGPoint(x: 21, y: 21))
            }
        }
        var flip = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: 24)
        return path.copy(using: &flip) ?? path
    }
    public static func color(_ hex: String) -> CGColor {
        let value = UInt32(hex, radix: 16) ?? 0
        return CGColor(red: CGFloat((value >> 16) & 255) / 255,
                       green: CGFloat((value >> 8) & 255) / 255,
                       blue: CGFloat(value & 255) / 255, alpha: 1)
    }
}
