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
    private let audioIcon = NSImageView()
    private let audio = NSSlider(value: 0.8, minValue: 0, maxValue: 1, target: nil, action: nil)
    private let brightnessIcon = NSImageView()
    private let brightness = NSSlider(value: 0.8, minValue: 0, maxValue: 1, target: nil, action: nil)
    private let unavailable = NSTextField(labelWithString: "Interface privée absente")
    var onAudioVolume: ((Double) -> Void)?
    var onBrightness: ((Double) -> Void)?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        orientation = .vertical
        alignment = .leading
        spacing = 8
        let audioRow = sliderRow(icon: audioIcon, slider: audio, label: "Volume du thème",
                                 action: #selector(changeAudioVolume))
        let brightnessRow = sliderRow(icon: brightnessIcon, slider: brightness,
                                      label: "Luminosité du thème",
                                      action: #selector(changeBrightness))
        addArrangedSubview(audioRow)
        addArrangedSubview(brightnessRow)
        unavailable.textColor = .secondaryLabelColor
        addArrangedSubview(unavailable)
        setSkin(nil)
    }

    required init?(coder: NSCoder) { nil }

    private func sliderRow(icon: NSImageView, slider: NSSlider, label: String,
                           action: Selector) -> NSStackView {
        let row = NSStackView()
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 10
        icon.imageScaling = .scaleProportionallyDown
        icon.setAccessibilityLabel(label)
        icon.widthAnchor.constraint(equalToConstant: 32).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 32).isActive = true
        slider.target = self
        slider.action = action
        slider.isContinuous = true
        slider.setAccessibilityLabel(label)
        slider.widthAnchor.constraint(equalToConstant: 176).isActive = true
        row.addArrangedSubview(icon)
        row.addArrangedSubview(slider)
        return row
    }

    func setSkin(_ interface: ResolvedThemeInterface?) {
        guard let interface else {
            [audioIcon, audio, brightnessIcon, brightness].forEach { $0.isHidden = true }
            unavailable.isHidden = false
            return
        }
        audioIcon.image = interface.asset(for: "theme.audio").flatMap(NSImage.init(contentsOf:))
        brightnessIcon.image = interface.asset(for: "display.brightness").flatMap(NSImage.init(contentsOf:))
        for slider in [audio, brightness] {
            let value = slider.doubleValue
            let cell = (slider.cell as? ThemeImageSliderCell) ?? ThemeImageSliderCell()
            cell.minValue = 0
            cell.maxValue = 1
            cell.doubleValue = value
            cell.trackImage = interface.asset(for: "slider.track").flatMap(NSImage.init(contentsOf:))
            cell.thumbImage = interface.asset(for: "slider.thumb").flatMap(NSImage.init(contentsOf:))
            slider.cell = cell
        }
        [audioIcon, audio, brightnessIcon, brightness].forEach { $0.isHidden = false }
        unavailable.isHidden = true
    }

    func setAudioVolume(_ value: Double) { audio.doubleValue = min(1, max(0, value)) }

    func setBrightness(_ value: Double) { brightness.doubleValue = min(1, max(0, value)) }

    @objc private func changeAudioVolume() { onAudioVolume?(audio.doubleValue) }
    @objc private func changeBrightness() { onBrightness?(brightness.doubleValue) }
}
