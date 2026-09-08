import AppKit

@MainActor func testControlInputPlaneProjection() throws {
    let control = LayoutRect(x: 24, y: 56, width: 40, height: 40)
    let primary = ControlInputPlane.projection(control: control,
        quartzDisplay: CGRect(x: 0, y: 0, width: 1512, height: 982),
        appKitScreen: CGRect(x: 0, y: 0, width: 1512, height: 982))
    guard primary.quartz == CGRect(x: 24, y: 56, width: 40, height: 40),
          primary.appKit == CGRect(x: 24, y: 886, width: 40, height: 40) else {
        throw ModelError.invalid("primary control input projection")
    }
    let secondary = ControlInputPlane.projection(control: control,
        quartzDisplay: CGRect(x: -1920, y: 120, width: 1920, height: 1080),
        appKitScreen: CGRect(x: -1920, y: -98, width: 1920, height: 1080))
    guard secondary.quartz == CGRect(x: -1896, y: 176, width: 40, height: 40),
          secondary.appKit == CGRect(x: -1896, y: 886, width: 40, height: 40) else {
        throw ModelError.invalid("secondary control input projection")
    }
    print("control-input-plane=PASS cases=2 (pure coordinate projection; no window shown)")
}
