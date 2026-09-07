import AppKit
import ProbeCore

@main
enum ProbeApplication {
    @MainActor
    static func main() {
        var arguments = Array(CommandLine.arguments.dropFirst())
        if arguments.isEmpty && Bundle.main.bundleIdentifier == "com.wallpaper.poc.desktop" {
            arguments = ["--mode", "desktop"]
        }
        if arguments == ["--help"] {
            print(ProbeOptions.usage)
            return
        }
        do {
            let options = try ProbeOptions.parse(arguments)
            let application = NSApplication.shared
            let delegate = ProbeDelegate(options: options)
            application.delegate = delegate
            withExtendedLifetime(delegate) { application.run() }
        } catch {
            FileHandle.standardError.write(Data("\(error)\n\(ProbeOptions.usage)\n".utf8))
            exit(2)
        }
    }
}

@MainActor
final class ProbeDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let options: ProbeOptions
    var state: ProbeState
    var window: NSWindow!
    var ui: ProbeUI?
    let scene = SceneView()
    var animationTimer: Timer?
    var scheduledTimers: [Timer] = []
    var startedAt: TimeInterval = 0
    var lastTick: TimeInterval = 0
    var visibilityNotifications = 0
    var invalidations = 0
    var smokeChecks: [String: Bool] = [:]
    var phaseAtPause: Double = 0
    var ticksAtPause = 0
    var snapshotName: String?
    var finishing = false
    var desktopMenu: DesktopMenu?
    var displaysAwake = true
    var sessionActive = true
    var desktopRestorations = 0
    var spacesNotifications = 0
    var schedulingSource = "suspended"
    var finderFrontmost = NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.apple.finder"

    init(options: ProbeOptions) {
        self.options = options
        // Desktop controls are explicit menu actions; the surface itself ignores input.
        self.state = ProbeState(interactive: true, animate: options.mode == .desktop)
    }

    var renderedScene: SceneView { ui?.scene ?? scene }

    func applicationDidFinishLaunching(_ notification: Notification) {
        startedAt = ProcessInfo.processInfo.systemUptime
        state.reducedMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        configureSurface()
        window.delegate = self
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged),
                                               name: NSApplication.didChangeScreenParametersNotification, object: nil)
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(motionChanged),
                                                          name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil)
        if options.mode == .desktop {
            observeDesktopLifecycle()
            desktopMenu = DesktopMenu(target: self, pause: #selector(togglePause),
                                      animation: #selector(toggleAnimation), effect: #selector(toggleEffect),
                                      quit: #selector(quit), duration: options.duration, readState: { [weak self] in
                self?.state ?? ProbeState(interactive: false)
            })
        }
        updateVisibility()
        refreshUI()
        schedule(after: options.duration, selector: #selector(deadlineReached))
        if options.smoke {
            for (index, delay) in [0.25, 0.5, 1.2, 1.6, 2.2, 2.5, 3.2].enumerated() {
                schedule(after: delay, selector: #selector(smokeStep(_:)), userInfo: index)
            }
        }
    }

    private func configureSurface() {
        if options.mode == .desktop {
            NSApp.setActivationPolicy(.accessory)
            guard let screen = NSScreen.main else { finish(reason: "screen-unavailable", code: 1) }
            window = PassiveDesktopWindow(contentRect: screen.frame, styleMask: .borderless,
                                          backing: .buffered, defer: false)
            window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)) + 1)
            window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
            window.ignoresMouseEvents = true
            window.hasShadow = false
            window.hidesOnDeactivate = false
            window.canHide = false
            window.isExcludedFromWindowsMenu = true
            window.isOpaque = true
            scene.isDesktop = true
            scene.wantsLayer = true
            scene.layerContentsRedrawPolicy = .onSetNeedsDisplay
            window.contentView = scene
            // Front of the desktop level, not front of normal applications.
            // This does not activate the app or change the key window.
            window.orderFrontRegardless()
        } else {
            NSApp.setActivationPolicy(.regular)
            window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 820, height: 580),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
            window.title = "Wallpaper · PoC isolé L1"
            window.minSize = NSSize(width: 760, height: 580)
            let controls = ProbeUI()
            ui = controls
            window.contentView = controls.root
            bindControls(controls)
            window.center()
            window.makeKeyAndOrderFront(nil)
            NSApp.activate()
        }
        window.isReleasedWhenClosed = false
        window.isRestorable = false
        window.backgroundColor = ProbeStyle.surface
    }

    private func bindControls(_ controls: ProbeUI) {
        for (button, selector) in [
            (controls.objectButton, #selector(openObject)), (controls.animationButton, #selector(toggleAnimation)),
            (controls.effectButton, #selector(toggleEffect)), (controls.pauseButton, #selector(togglePause)),
            (controls.closePanelButton, #selector(closePanel)), (controls.quitButton, #selector(quit))
        ] {
            button.target = self
            button.action = selector
        }
        controls.scene.selectObject = { [weak self] in self?.openObject() }
    }

    @objc func openObject() { state.openPanel(); refreshUI() }
    @objc func closePanel() { state.closePanel(); refreshUI() }
    @objc func toggleAnimation() { state.toggleAnimation(); refreshUI() }
    @objc func toggleEffect() { state.toggleEffect(); refreshUI() }
    @objc func togglePause() { state.togglePause(); refreshUI() }
    @objc func quit() { finish(reason: "user", code: 0) }
    @objc func deadlineReached() { finish(reason: "deadline", code: options.smoke ? 1 : 0) }

    func windowShouldClose(_ sender: NSWindow) -> Bool { finish(reason: "window-closed", code: 0) }
    func windowDidChangeOcclusionState(_ notification: Notification) { updateVisibility() }
    func windowDidMiniaturize(_ notification: Notification) { updateVisibility() }
    func windowDidDeminiaturize(_ notification: Notification) { updateVisibility() }

    @objc private func screensChanged() {
        if options.mode == .desktop {
            guard let screen = NSScreen.main else { finish(reason: "screen-lost", code: 1) }
            window.setFrame(screen.frame, display: true)
            restoreDesktop()
        }
        updateVisibility()
    }

    @objc private func motionChanged() {
        state.reducedMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        refreshUI()
    }

    private func observeDesktopLifecycle() {
        let center = NSWorkspace.shared.notificationCenter
        for (name, selector) in [
            (NSWorkspace.activeSpaceDidChangeNotification, #selector(spaceChanged)),
            (NSWorkspace.didActivateApplicationNotification, #selector(foregroundChanged(_:))),
            (NSWorkspace.screensDidSleepNotification, #selector(displaysSlept)),
            (NSWorkspace.screensDidWakeNotification, #selector(displaysWoke)),
            (NSWorkspace.sessionDidResignActiveNotification, #selector(sessionResigned)),
            (NSWorkspace.sessionDidBecomeActiveNotification, #selector(sessionResumed))
        ] { center.addObserver(self, selector: selector, name: name, object: nil) }
    }

    @objc private func foregroundChanged(_ notification: Notification) {
        if let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication {
            finderFrontmost = app.bundleIdentifier == "com.apple.finder"
        }
        updateVisibility()
    }
    @objc private func spaceChanged() { spacesNotifications += 1; restoreDesktop() }
    @objc private func displaysSlept() { displaysAwake = false; updateVisibility() }
    @objc private func displaysWoke() { displaysAwake = true; restoreDesktop() }
    @objc private func sessionResigned() { sessionActive = false; updateVisibility() }
    @objc private func sessionResumed() { sessionActive = true; restoreDesktop() }

    private func restoreDesktop() {
        guard options.mode == .desktop, !finishing, displaysAwake, sessionActive else { return }
        desktopRestorations += 1
        // Reorder the retained window; never replace the scene or reset its phase.
        window.orderFrontRegardless()
        updateVisibility()
        refreshUI()
    }

    private func updateVisibility() {
        guard window != nil, !finishing else { return }
        visibilityNotifications += 1
        let previous = state.visibility
        let appKitVisible = window.occlusionState.contains(.visible) && !window.isMiniaturized
        if options.mode == .desktop {
            schedulingSource = DesktopActivity.source(ordered: window.isVisible,
                activeSpace: window.isOnActiveSpace, appKitVisible: appKitVisible,
                finderFrontmost: finderFrontmost,
                awake: displaysAwake, sessionActive: sessionActive)
            state.visibility = schedulingSource == "suspended" ? .notVisible : .visible
        } else {
            state.visibility = appKitVisible ? .visible : .notVisible
        }
        if previous != state.visibility { refreshUI() } else { syncAnimationTimer() }
    }

    private func refreshUI() {
        renderedScene.state = state
        renderedScene.needsDisplay = true
        invalidations += 1
        ui?.panel.isHidden = !state.panelOpen
        ui?.animationButton.title = state.animationRequested ? "Arrêter l’animation" : "Animer"
        ui?.effectButton.title = state.effectEnabled ? "Retirer le halo" : "Activer le halo"
        ui?.pauseButton.title = state.paused ? "Reprendre" : "Pause"
        if let controls = ui {
            for button in [controls.animationButton, controls.effectButton, controls.pauseButton] {
                button.setAccessibilityLabel(button.title)
            }
        }
        ui?.status.stringValue = "Ticks : \(state.ticks) · pause : \(state.paused) · visibilité AppKit : \(state.visibility.rawValue)\nRéduction des animations : \(state.reducedMotion) · arrêt automatique : \(Int(options.duration)) s"
        syncAnimationTimer()
    }

    private func syncAnimationTimer() {
        if state.shouldAnimate && animationTimer == nil {
            lastTick = ProcessInfo.processInfo.systemUptime
            let timer = Timer(timeInterval: ProbeStyle.frameInterval, target: self,
                              selector: #selector(tick), userInfo: nil, repeats: true)
            timer.tolerance = ProbeStyle.frameInterval / 4
            animationTimer = timer
            RunLoop.main.add(timer, forMode: .common)
        } else if !state.shouldAnimate {
            animationTimer?.invalidate()
            animationTimer = nil
        }
    }

    @objc private func tick() {
        let now = ProcessInfo.processInfo.systemUptime
        let delta = now - lastTick
        lastTick = now
        if state.advance(by: delta) { refreshUI() }
    }

    private func schedule(after seconds: Double, selector: Selector, userInfo: Any? = nil) {
        let timer = Timer(timeInterval: seconds, target: self, selector: selector, userInfo: userInfo, repeats: false)
        scheduledTimers.append(timer)
        RunLoop.main.add(timer, forMode: .common)
    }

    @objc private func smokeStep(_ timer: Timer) {
        if options.mode == .desktop {
            desktopSmokeStep(timer)
            return
        }
        guard let step = timer.userInfo as? Int, let controls = ui else { return }
        switch step {
        case 0:
            controls.objectButton.performClick(nil)
            smokeChecks["object_opens_panel"] = state.panelOpen && !controls.panel.isHidden
        case 1:
            controls.animationButton.performClick(nil)
            smokeChecks["animation_requested"] = state.animationRequested
        case 2:
            controls.pauseButton.performClick(nil)
            phaseAtPause = state.phaseSeconds
            ticksAtPause = state.ticks
            smokeChecks["pause_stops_timer"] = state.paused && animationTimer == nil
        case 3:
            smokeChecks["pause_freezes_phase"] = state.phaseSeconds == phaseAtPause && state.ticks == ticksAtPause
            controls.pauseButton.performClick(nil)
        case 4:
            smokeChecks["animation_progressed_or_reduced_motion_respected"] = state.reducedMotion
                ? state.ticks == 0 && animationTimer == nil : state.ticks > ticksAtPause
            controls.animationButton.performClick(nil)
            smokeChecks["stop_releases_timer"] = !state.animationRequested && animationTimer == nil
        case 5:
            controls.effectButton.performClick(nil)
            smokeChecks["effect_updates_state"] = state.effectEnabled
            controls.closePanelButton.performClick(nil)
            smokeChecks["panel_closes"] = !state.panelOpen
            controls.objectButton.performClick(nil)
        default:
            smokeChecks["window_not_desktop"] = !window.ignoresMouseEvents && options.mode == .window
            if options.snapshot { captureOwnView() }
            let expectedCount = options.snapshot ? 10 : 9
            finish(reason: "smoke", code: smokeChecks.count == expectedCount && smokeChecks.values.allSatisfy { $0 } ? 0 : 1)
        }
    }

    private func desktopSmokeStep(_ timer: Timer) {
        guard let step = timer.userInfo as? Int, let menu = desktopMenu?.item.menu else { return }
        switch step {
        case 0:
            smokeChecks["desktop_ignores_input"] = window.ignoresMouseEvents && !window.canBecomeKey
            smokeChecks["menu_available"] = menu.numberOfItems == 6
        case 1:
            smokeChecks["animation_requested"] = state.animationRequested
        case 2:
            menu.performActionForItem(at: 2)
            phaseAtPause = state.phaseSeconds
            ticksAtPause = state.ticks
            smokeChecks["menu_pause_stops_timer"] = state.paused && animationTimer == nil
        case 3:
            smokeChecks["pause_preserves_phase"] = state.phaseSeconds == phaseAtPause && state.ticks == ticksAtPause
            menu.performActionForItem(at: 2)
        case 4:
            let originalWindow = window.windowNumber
            let phase = state.phaseSeconds
            spaceChanged() // Handler-only test: not a real macOS Spaces transition.
            smokeChecks["space_handler_retains_surface"] = originalWindow == window.windowNumber && phase == state.phaseSeconds
            displaysSlept()
            smokeChecks["sleep_handler_stops_timer"] = animationTimer == nil
            displaysWoke()
        case 5:
            menu.performActionForItem(at: 4)
            smokeChecks["menu_effect_updates_state"] = state.effectEnabled
            menu.performActionForItem(at: 3)
            smokeChecks["menu_animation_stop"] = !state.animationRequested && animationTimer == nil
        default:
            let passed = smokeChecks.count == 9 && smokeChecks.values.allSatisfy { $0 }
            finish(reason: "desktop-handler-smoke", code: passed ? 0 : 1)
        }
    }

    private func captureOwnView() {
        guard let root = window.contentView,
              let bitmap = root.bitmapImageRepForCachingDisplay(in: root.bounds) else {
            smokeChecks["own_view_snapshot"] = false
            return
        }
        root.layoutSubtreeIfNeeded()
        root.cacheDisplay(in: root.bounds, to: bitmap)
        guard let data = bitmap.representation(using: .png, properties: [:]) else {
            smokeChecks["own_view_snapshot"] = false
            return
        }
        let name = "own-view-\(UUID().uuidString).png"
        do {
            try data.write(to: URL(fileURLWithPath: name), options: .withoutOverwriting)
            snapshotName = name
            smokeChecks["own_view_snapshot"] = true
        } catch { smokeChecks["own_view_snapshot"] = false }
    }

    private func finish(reason: String, code: Int32) -> Never {
        finishing = true
        let timerActiveBeforeCleanup = animationTimer != nil
        animationTimer?.invalidate()
        animationTimer = nil
        scheduledTimers.forEach { $0.invalidate() }
        NotificationCenter.default.removeObserver(self)
        NSWorkspace.shared.notificationCenter.removeObserver(self)
        desktopMenu?.remove()
        let receipt: [String: Any] = [
            "schema_version": 1, "poc": "macos-surface-l1", "mode": options.mode.rawValue,
            "reason": reason, "exit_code": code,
            "elapsed_seconds": max(0, ProcessInfo.processInfo.systemUptime - startedAt),
            "os": ProcessInfo.processInfo.operatingSystemVersionString,
            "draw_callbacks": renderedScene.drawCount, "simulation_ticks": state.ticks,
            "local_actions": state.actions, "requested_invalidations": invalidations,
            "visibility_notifications": visibilityNotifications, "visibility_signal": state.visibility.rawValue,
            "appkit_visible": window?.occlusionState.contains(.visible) ?? false,
            "scheduling_source": schedulingSource,
            "finder_frontmost": finderFrontmost,
            "spaces_notifications": spacesNotifications, "desktop_restorations": desktopRestorations,
            "hides_on_deactivate": window?.hidesOnDeactivate ?? false,
            "layer_backed": renderedScene.wantsLayer,
            "input_policy": options.mode == .desktop ? "explicit-menu-only" : "window",
            "motion_observed_in_ticks": state.ticks > 0,
            "transitions_evidence": options.smoke && options.mode == .desktop ? "synthetic-handlers-only" : "not-qualified",
            "timer_active_before_cleanup": timerActiveBeforeCleanup,
            "timer_active_after_cleanup": false, "reduced_motion": state.reducedMotion,
            "ignores_mouse_events": window?.ignoresMouseEvents ?? true,
            "is_key_window": window?.isKeyWindow ?? false,
            "window_level": window?.level.rawValue ?? 0,
            "window_ordered_visible": window?.isVisible ?? false,
            "window_width": window?.frame.width ?? 0,
            "window_height": window?.frame.height ?? 0,
            "bundle_id": Bundle.main.bundleIdentifier ?? "unbundled",
            "application_active": NSApp.isActive,
            "below_desktop_icons": (window?.level.rawValue ?? 0) < Int(CGWindowLevelForKey(.desktopIconWindow)),
            "backing_scale": window?.backingScaleFactor ?? 0,
            "smoke_checks": smokeChecks, "snapshot": snapshotName ?? "not-requested",
            "energy_verdict": "not-measured", "finder_input_verdict": "not-tested",
            "desktop_visibility_verdict": "requires-manual-observation"
        ]
        window?.orderOut(nil)
        do {
            let data = try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys])
            FileHandle.standardOutput.write(data + Data("\n".utf8))
        } catch {
            FileHandle.standardError.write(Data("Diagnostic serialization failed\n".utf8))
            exit(1)
        }
        exit(code)
    }
}
