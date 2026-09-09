import CoreGraphics
import Foundation

/// Qualifies the window attached by WindowServer to the exact mouse event.
/// This replaces the former transparent AppKit proxy windows completely.
enum DesktopEventTarget {
    struct Window: Equatable {
        let id: CGWindowID
        let layer: Int
    }

    static func isDesktop(_ event: CGEvent) -> Bool {
        let handler = event.getIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent)
        let raw = event.getIntegerValueField(.mouseEventWindowUnderMousePointer)
        let value = handler > 0 ? handler : raw
        guard value > 0, value <= Int64(UInt32.max) else { return value == 0 }
        return describe(CGWindowID(value)).map(isDesktop) ?? false
    }

    static func isDesktop(_ window: Window?) -> Bool {
        guard let window else { return true }
        return window.layer < 0
    }

    private static func describe(_ id: CGWindowID) -> Window? {
        let ids = [NSNumber(value: id)] as CFArray
        guard let descriptions = CGWindowListCreateDescriptionFromArray(ids) as? [[String: Any]],
              let description = descriptions.first,
              let number = description[kCGWindowNumber as String] as? NSNumber,
              number.uint32Value == id,
              let layer = description[kCGWindowLayer as String] as? NSNumber else { return nil }
        return Window(id: id, layer: layer.intValue)
    }
}
