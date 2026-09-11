import AppKit

@MainActor final class ThemeImageSliderCell: NSSliderCell {
    var trackImage: NSImage?
    var thumbImage: NSImage?

    override func drawBar(inside rect: NSRect, flipped: Bool) {
        guard let trackImage else { super.drawBar(inside: rect, flipped: flipped); return }
        let bar = NSRect(x: rect.minX, y: rect.midY - 5, width: rect.width, height: 10)
        trackImage.draw(in: bar, from: .zero, operation: .sourceOver, fraction: 0.88,
                        respectFlipped: true, hints: [.interpolation: NSImageInterpolation.high])
    }

    override func drawKnob(_ knobRect: NSRect) {
        guard let thumbImage else { super.drawKnob(knobRect); return }
        thumbImage.draw(in: knobRect.insetBy(dx: -2, dy: -2), from: .zero, operation: .sourceOver,
                        fraction: 1, respectFlipped: true,
                        hints: [.interpolation: NSImageInterpolation.high])
    }
}

/// Native presentation of semantic theme controls. A missing private skin hides
/// image controls instead of substituting SF Symbols or bundled artwork.
@MainActor final class ThemeControlsView: NSStackView {
    private let audio = NSButton()
    private let desktop = NSButton()
    private let brightnessIcon = NSImageView()
    private let brightness = NSSlider(value: 0.8, minValue: 0, maxValue: 1, target: nil, action: nil)
    private let unavailable = NSTextField(labelWithString: "Interface privée absente")
    var onAudio: (() -> Void)?
    var onDesktop: (() -> Void)?
    var onBrightness: ((Double) -> Void)?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        orientation = .horizontal
        alignment = .centerY
        spacing = 10
        for (button, label, action) in [
            (audio, "Audio du thème", #selector(toggleAudio)),
            (desktop, "Fichiers du bureau", #selector(toggleDesktop))
        ] {
            button.target = self
            button.action = action
            button.isBordered = false
            button.imageScaling = .scaleProportionallyDown
            button.setAccessibilityLabel(label)
            button.widthAnchor.constraint(equalToConstant: 42).isActive = true
            button.heightAnchor.constraint(equalToConstant: 42).isActive = true
            addArrangedSubview(button)
        }
        brightnessIcon.imageScaling = .scaleProportionallyDown
        brightnessIcon.setAccessibilityLabel("Luminosité du thème")
        brightnessIcon.widthAnchor.constraint(equalToConstant: 32).isActive = true
        brightnessIcon.heightAnchor.constraint(equalToConstant: 32).isActive = true
        addArrangedSubview(brightnessIcon)
        brightness.target = self
        brightness.action = #selector(changeBrightness)
        brightness.isContinuous = true
        brightness.setAccessibilityLabel("Luminosité du thème")
        brightness.widthAnchor.constraint(equalToConstant: 176).isActive = true
        addArrangedSubview(brightness)
        unavailable.textColor = .secondaryLabelColor
        addArrangedSubview(unavailable)
        setSkin(nil)
    }

    required init?(coder: NSCoder) { nil }

    func setSkin(_ interface: ResolvedThemeInterface?) {
        guard let interface else {
            [audio, desktop, brightnessIcon, brightness].forEach { $0.isHidden = true }
            unavailable.isHidden = false
            return
        }
        audio.image = interface.asset(for: "theme.audio.muted").flatMap(NSImage.init(contentsOf:))
        desktop.image = interface.asset(for: "desktop.files.visible").flatMap(NSImage.init(contentsOf:))
        brightnessIcon.image = interface.asset(for: "display.brightness").flatMap(NSImage.init(contentsOf:))
        if let cell = brightness.cell as? ThemeImageSliderCell {
            cell.trackImage = interface.asset(for: "slider.track").flatMap(NSImage.init(contentsOf:))
            cell.thumbImage = interface.asset(for: "slider.thumb").flatMap(NSImage.init(contentsOf:))
        } else {
            let cell = ThemeImageSliderCell()
            cell.minValue = 0
            cell.maxValue = 1
            cell.doubleValue = brightness.doubleValue
            cell.trackImage = interface.asset(for: "slider.track").flatMap(NSImage.init(contentsOf:))
            cell.thumbImage = interface.asset(for: "slider.thumb").flatMap(NSImage.init(contentsOf:))
            brightness.cell = cell
        }
        [audio, desktop, brightnessIcon, brightness].forEach { $0.isHidden = false }
        unavailable.isHidden = true
    }

    func setMuted(_ muted: Bool, interface: ResolvedThemeInterface?) {
        let slot = muted ? "theme.audio.muted" : "theme.audio.unmuted"
        audio.image = interface?.asset(for: slot).flatMap(NSImage.init(contentsOf:))
    }

    func setDesktopVisible(_ visible: Bool?, interface: ResolvedThemeInterface?) {
        let slot = visible == false ? "desktop.files.hidden" : "desktop.files.visible"
        desktop.image = interface?.asset(for: slot).flatMap(NSImage.init(contentsOf:))
    }

    func setBrightness(_ value: Double) { brightness.doubleValue = min(1, max(0, value)) }

    @objc private func toggleAudio() { onAudio?() }
    @objc private func toggleDesktop() { onDesktop?() }
    @objc private func changeBrightness() { onBrightness?(brightness.doubleValue) }
}
