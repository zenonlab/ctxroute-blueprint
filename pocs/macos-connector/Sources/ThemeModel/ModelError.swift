import Foundation

public enum ModelError: Error, LocalizedError {
    case invalid(String)

    public var errorDescription: String? {
        guard case .invalid(let reason) = self else { return nil }
        return reason
    }
}
