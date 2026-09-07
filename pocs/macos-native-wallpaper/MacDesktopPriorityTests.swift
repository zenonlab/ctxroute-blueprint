import Foundation

@main
enum MacDesktopPriorityTests {
    static func main() {
        let background = FinderTargetSignature(role: "AXScrollArea", subrole: nil,
            identifier: "qualified-fixture-only")
        let classifier = MacDesktopPriorityClassifier(qualifiedFinderBackgrounds: [background])
        precondition(classifier.classify(.untrusted) == .unknown)
        precondition(classifier.classify(.unavailable) == .unknown)
        precondition(classifier.classify(.target(target(bundle: "com.apple.Terminal", role: "AXWindow"))) == .nativeContent)
        precondition(classifier.classify(.target(target(bundle: "com.apple.finder", role: "AXImage"))) == .nativeContent)
        precondition(classifier.classify(.target(target(bundle: "com.apple.finder", role: "AXScrollArea",
            identifier: "qualified-fixture-only"))) == .wallpaperEligible)
        precondition(classifier.classify(.target(target(bundle: "com.apple.finder", role: "AXScrollArea",
            identifier: "not-qualified"))) == .nativeContent)
        precondition(DesktopTargetDisposition.unknown.nativeContentHasPriority)
        precondition(!DesktopTargetDisposition.wallpaperEligible.nativeContentHasPriority)
        print("PASS: 8 macOS priority checks; untrusted, unavailable and unqualified targets fail closed")
    }

    private static func target(bundle: String, role: String, identifier: String? = nil) -> DesktopTarget {
        DesktopTarget(processIdentifier: 42, bundleIdentifier: bundle, role: role,
            subrole: nil, identifier: identifier)
    }
}
