import AppKit
import ApplicationServices
import CoreGraphics

enum DesktopProbeResult: Equatable {
    case target(DesktopTarget)
    case untrusted
    case unavailable
}

struct DesktopTarget: Equatable {
    let processIdentifier: pid_t
    let bundleIdentifier: String?
    let role: String?
    let subrole: String?
    let identifier: String?
}

struct FinderTargetSignature: Hashable {
    let role: String?
    let subrole: String?
    let identifier: String?
}

enum DesktopTargetDisposition: Equatable {
    case wallpaperEligible
    case nativeContent
    case unknown

    var nativeContentHasPriority: Bool { self != .wallpaperEligible }
}

struct MacDesktopPriorityClassifier {
    let qualifiedFinderBackgrounds: Set<FinderTargetSignature>

    init(qualifiedFinderBackgrounds: Set<FinderTargetSignature> = []) {
        self.qualifiedFinderBackgrounds = qualifiedFinderBackgrounds
    }

    func classify(_ result: DesktopProbeResult) -> DesktopTargetDisposition {
        guard case let .target(target) = result else { return .unknown }
        guard target.bundleIdentifier == "com.apple.finder" else { return .nativeContent }
        let signature = FinderTargetSignature(role: target.role, subrole: target.subrole,
            identifier: target.identifier)
        return qualifiedFinderBackgrounds.contains(signature) ? .wallpaperEligible : .nativeContent
    }
}

// Read-only probe. It never prompts for Accessibility and never performs an AX action.
struct AXDesktopTargetProbe {
    func target(atTopLeft point: CGPoint) -> DesktopProbeResult {
        guard AXIsProcessTrusted() else { return .untrusted }
        var element: AXUIElement?
        let result = AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(),
            Float(point.x), Float(point.y), &element)
        guard result == .success, let element else { return .unavailable }
        var pid: pid_t = 0
        guard AXUIElementGetPid(element, &pid) == .success else { return .unavailable }
        return .target(DesktopTarget(processIdentifier: pid,
            bundleIdentifier: NSRunningApplication(processIdentifier: pid)?.bundleIdentifier,
            role: attribute(kAXRoleAttribute, from: element),
            subrole: attribute(kAXSubroleAttribute, from: element),
            identifier: attribute(kAXIdentifierAttribute, from: element)))
    }

    private func attribute(_ name: String, from element: AXUIElement) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
        return value as? String
    }
}
