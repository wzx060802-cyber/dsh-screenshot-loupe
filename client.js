/**
 * Client half of the screenshot-to-composer plugin.
 *
 * The capture itself happens on the Host, on the real screen: `mode=region`
 * freezes the desktop and shows a snip overlay there, so the area is dragged
 * over the screen itself instead of a picture of it inside the page. The
 * client only asks for a frame and attaches what comes back.
 *
 * Entry points: the camera button in the composer tool row snips right away;
 * the composer's "+" menu opens a small chooser with both modes and the
 * remembered "hide this window" choice.
 */
window.__ModuleLoader__.load({
  id: 'dsh-screenshot-loupe',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Host route serving one freshly captured PNG. */
    const CAPTURE_ENDPOINT = '/dsh-screenshot-loupe/screen.png'
    /** Host route reporting what this platform can do. */
    const PROBE_ENDPOINT = '/dsh-screenshot-loupe/probe'
    /** Locale namespace of this plugin's own strings. */
    const NS = 'screenshotAttach'
    /** Class prefix; every rule in STYLE_TEXT is scoped by it. */
    const CLASS = 'dsh-screenshot'
    /** Head marker so a reloaded plugin replaces its own sheet instead of stacking one. */
    const STYLE_MARKER = 'data-dsh-plugin-screenshot'
    /** Held long enough to read a failure without covering the composer. */
    const NOTICE_HOLD_ERROR_MS = 9000
    /** Storage key of the remembered "hide this window" choice. */
    const HIDE_KEY = 'dsh-screenshot-loupe:hide-window'

    const STYLE_TEXT = [
      /* Same geometry and fill as the shipped attach circle it sits beside. */
      '.dsh-screenshot-button {',
      '  display: grid;',
      '  place-items: center;',
      '  flex: none;',
      '  width: 28px;',
      '  height: 28px;',
      '  padding: 0;',
      '  border: none;',
      '  border-radius: 999px;',
      '  background: var(--dsw-specific-selector, var(--dsw-alias-bg-layer-2));',
      '  color: var(--dsw-alias-label-primary);',
      '  cursor: pointer;',
      '}',
      '@media (hover: hover) {',
      '  .dsh-screenshot-button:hover:not(:disabled) {',
      '    background: var(--dsw-alias-interactive-bg-hover-solid,',
      '      var(--dsw-specific-selector, var(--dsw-alias-bg-layer-2)));',
      '  }',
      '}',
      '.dsh-screenshot-button:disabled { opacity: 0.5; cursor: progress; }',
      '.dsh-screenshot-spinner { animation: dsh-screenshot-spin 900ms linear infinite; }',
      '@media (prefers-reduced-motion: reduce) {',
      '  .dsh-screenshot-spinner { animation-duration: 2400ms; }',
      '}',
      '@keyframes dsh-screenshot-spin { to { transform: rotate(360deg); } }',
      /* Chooser, anchored in the composer card's overlay hole. Same surface
         recipe as the host's own popovers: the hairline rides the elevation
         stroke instead of an extra border. */
      '.dsh-screenshot-panel {',
      '  position: absolute;',
      '  left: 0;',
      '  bottom: calc(100% + 8px);',
      '  box-sizing: border-box;',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 2px;',
      '  width: 248px;',
      '  padding: 6px;',
      '  border: 0;',
      '  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);',
      '  border-radius: var(--dsw-radius-lg, var(--dsw-radius-md, 8px));',
      '  background: var(--dsw-specific-menu, var(--dsw-alias-bg-overlay));',
      '  box-shadow: var(--dsw-elevation-panel, var(--dsw-elevation-soft, none));',
      '}',
      '.dsh-screenshot-panel-item {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  width: 100%;',
      '  padding: 6px 8px;',
      '  border: none;',
      '  border-radius: var(--dsw-radius-sm, 6px);',
      '  background: transparent;',
      '  color: var(--dsw-alias-label-primary);',
      '  font-size: 13px;',
      '  line-height: 20px;',
      '  text-align: left;',
      '  cursor: pointer;',
      '}',
      '@media (hover: hover) {',
      '  .dsh-screenshot-panel-item:hover:not(:disabled) {',
      '    background: var(--dsw-alias-bg-layer-2);',
      '  }',
      '}',
      '.dsh-screenshot-panel-item:disabled { opacity: 0.5; cursor: default; }',
      '.dsh-screenshot-panel-check {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  margin-top: 4px;',
      '  padding: 6px 8px 2px;',
      '  border-top: 1px solid var(--dsw-alias-border-l1);',
      '  color: var(--dsw-alias-label-secondary);',
      '  font-size: 12px;',
      '  line-height: 18px;',
      '  cursor: pointer;',
      '}',
      '.dsh-screenshot-panel-check input {',
      '  margin: 0;',
      '  accent-color: var(--dsw-alias-brand-primary);',
      '}',
      /* Failure notice: body copy keeps the primary label color, the only
         pairing with guaranteed contrast on the overlay fill in both themes;
         the failure reads through the leading error dot. */
      '.dsh-screenshot-notice {',
      '  position: absolute;',
      '  left: 50%;',
      '  bottom: calc(100% + 8px);',
      '  transform: translateX(-50%);',
      '  display: flex;',
      '  align-items: flex-start;',
      '  gap: 6px;',
      '  max-width: min(360px, 80vw);',
      '  padding: 6px 10px;',
      '  border: 1px solid var(--dsw-alias-border-l1);',
      '  border-radius: var(--dsw-radius-md, 8px);',
      '  background: var(--dsw-alias-bg-overlay);',
      '  box-shadow: var(--dsw-elevation-soft, none);',
      '  color: var(--dsw-alias-label-primary);',
      '  font-size: 12px;',
      '  line-height: 18px;',
      '  pointer-events: none;',
      '}',
      '.dsh-screenshot-notice-dot {',
      '  flex: none;',
      '  width: 6px;',
      '  height: 6px;',
      '  margin-top: 6px;',
      '  border-radius: 999px;',
      '  background: var(--dsw-alias-state-error-primary);',
      '}',
    ].join('\n')

    const DICTS = {
      en: {
        'command.label': 'Screenshot',
        'command.description': 'Snip an area or take the whole screen and attach it to the message',
        'button.label': 'Snip a screenshot',
        'button.busy': 'Capturing…',
        'panel.label': 'Screenshot options',
        'panel.region': 'Snip an area',
        'panel.full': 'Take the whole screen',
        'panel.hide': 'Hide this window while capturing',
        'notice.failed': 'Screenshot failed: {reason}',
        'notice.noComposer': 'no message editor is available',
        'notice.refused': 'the message editor cannot take an image right now',
        'notice.badResponse': 'no screenshot was captured (status {status})',
        'overlay.hint': 'Drag to snip, annotate inside, Enter to finish · Esc cancels',
        'overlay.hintPlain': 'Drag to snip · Esc cancels',
      },
      zh: {
        'command.label': '截屏',
        'command.description': '在屏幕上框选一块区域，或截取整块屏幕，并添加到消息',
        'button.label': '截屏',
        'button.busy': '截屏中…',
        'panel.label': '截屏选项',
        'panel.region': '选区截屏',
        'panel.full': '整屏截屏',
        'panel.hide': '截屏时隐藏本窗口',
        'notice.failed': '截屏失败：{reason}',
        'notice.noComposer': '没有可用的输入框',
        'notice.refused': '输入框当前无法接收图片',
        'notice.badResponse': '没有取到截图（状态 {status}）',
        'overlay.hint': '拖拽框选，框内可标注 · 回车完成 · Esc 取消',
        'overlay.hintPlain': '拖拽框选 · Esc 取消',
      },
    }

    /**
     * Minimal observable value for a component-shared UI state.
     * @param initial - starting value.
     */
    function createStore(initial) {
      let value = initial
      const listeners = new Set()
      return {
        get: () => value,
        set: (next) => {
          if (Object.is(next, value)) return
          value = next
          for (const listener of [...listeners]) listener()
        },
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }
    }

    /**
     * Subscribe one component to a store.
     * @param store - store created by {@link createStore}.
     */
    function useStore(store) {
      const [value, setValue] = React.useState(store.get)
      React.useEffect(() => {
        const unsubscribe = store.subscribe(() => { setValue(store.get()) })
        setValue(store.get())
        return unsubscribe
      }, [store])
      return value
    }

    /** Latest failure notice; the notice component reads it. */
    const noticeStore = createStore(null)
    /** Chooser state: open flag and the remembered "hide this window" choice. */
    const panelStore = createStore({ open: false, hideWindow: true })
    /** What the Host can do on this platform; read once when the plugin loads. */
    const capsStore = createStore({ annotate: true, hideWindow: true, region: true })
    /** Capture in flight; the toolbar button and the chooser show progress from it. */
    const busyStore = createStore(false)
    /** Shared in-flight capture chain, so the entry points never double up. */
    let captureRun = null
    let noticeSeq = 0

    /** Read the remembered hide choice. */
    function readHideWindow() {
      try {
        const raw = localStorage.getItem(HIDE_KEY)
        return raw === null ? true : raw === '1'
      } catch {
        return true
      }
    }

    /**
     * Remember the hide choice for later captures.
     * @param value - whether this window stays out of the shot.
     */
    function writeHideWindow(value) {
      try {
        localStorage.setItem(HIDE_KEY, value ? '1' : '0')
      } catch {
        // A browser that refuses storage keeps the current session's choice only.
      }
    }

    /**
     * Replace the visible failure notice.
     * @param text - localized sentence; the empty string clears it.
     */
    function publishNotice(text) {
      if (text === '') {
        noticeStore.set(null)
        return
      }
      noticeSeq += 1
      noticeStore.set({ seq: noticeSeq, text })
    }

    /** Hide the notice if the caller still owns the visible one. */
    function retireNotice(seq) {
      const current = noticeStore.get()
      if (current === null || current.seq !== seq) return
      noticeStore.set(null)
    }

    /**
     * The composer card currently able to take a paste, or null.
     * @returns the card element of any mounted composer.
     */
    function composerCard() {
      return document.querySelector('[data-composer-card]')
    }

    /**
     * Hand files to the composer through the shipped document paste route:
     * a paste whose target is outside any editable control is routed to the
     * focused (else main) composer, which runs its own intake validation and
     * prevents the event exactly when it took the files. A refused paste is
     * therefore observable, not assumed.
     * @param files - browser files to add, in order.
     * @param refusedText - localized copy for a composer that took nothing.
     */
    function pasteIntoComposer(files, refusedText) {
      const transfer = new DataTransfer()
      for (const file of files) transfer.items.add(file)
      let event = null
      try {
        event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
      } catch {
        event = null
      }
      if (event === null || event.clipboardData !== transfer) {
        // Constructor support varies; the route only reads clipboardData.
        event = new Event('paste', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'clipboardData', { value: transfer, configurable: true })
      }
      // A body target keeps composedPath() off every editable control, which is
      // the route's condition for taking a paste it was not invoked from.
      document.body.dispatchEvent(event)
      if (!event.defaultPrevented) throw new Error(refusedText)
    }

    /** Compact local-time stamp for the drafted image name. */
    function fileStamp() {
      const now = new Date()
      const pad = value => String(value).padStart(2, '0')
      return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
        + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    }

    /**
     * Install the plugin's stylesheet once and return its removal.
     * @returns disposer removing the sheet if it is still the installed one.
     */
    function installStyles() {
      for (const stale of document.querySelectorAll(`style[${STYLE_MARKER}]`)) stale.remove()
      const style = document.createElement('style')
      style.setAttribute(STYLE_MARKER, '')
      style.textContent = STYLE_TEXT
      document.head.appendChild(style)
      return () => { style.remove() }
    }

    /**
     * Camera glyph for the command row, the chooser, and the capture button.
     * Line work with the same stroke weight as the shipped attach control it
     * sits beside, so the circles read as one toolbar group.
     */
    function CameraIcon(props) {
      const size = props.size === undefined ? 14 : props.size
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        className: props.className,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: 'false',
      },
        h('rect', { x: 1.7, y: 4.9, width: 12.6, height: 9.1, rx: 2.5 }),
        h('path', { d: 'M5.6 4.9 L6.2 3.4 A1.3 1.3 0 0 1 7.4 2.6 H8.6 A1.3 1.3 0 0 1 9.8 3.4 L10.4 4.9' }),
        h('circle', { cx: 8, cy: 9.4, r: 2.35 }))
    }

    /** Turning arc while the Host is capturing. */
    function CameraBusyIcon(props) {
      const size = props.size === undefined ? 14 : props.size
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        className: props.className === undefined ? 'dsh-screenshot-spinner' : `${props.className} dsh-screenshot-spinner`,
        'aria-hidden': true,
        focusable: 'false',
      },
        h('circle', { cx: 8, cy: 8, r: 6, fill: 'none', stroke: 'currentColor', strokeOpacity: 0.3, strokeWidth: 2 }),
        h('path', { d: 'M8 2a6 6 0 0 1 6 6', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTS), 'dsh-screenshot-loupe: dictionaries')
        ctx.effect(() => installStyles(), 'dsh-screenshot-loupe: stylesheet')
        const t = ctx.locale.bind(NS)
        panelStore.set({ open: false, hideWindow: readHideWindow() })

        // Ask once what this platform can do: the chooser hides what it cannot
        // honour, and the overlay hint drops the annotation part elsewhere.
        void (async () => {
          try {
            const response = await fetch(PROBE_ENDPOINT, { cache: 'no-store', credentials: 'same-origin' })
            if (!response.ok) return
            const data = await response.json()
            capsStore.set({
              annotate: data.annotate === true,
              hideWindow: data.hideWindow === true,
              region: data.region !== false,
            })
          } catch {
            // Keep the Windows-shaped defaults when the probe cannot be read.
          }
        })()

        /** Report one failure in the composer's own notice. */
        function reportFailure(error) {
          const reason = error instanceof Error ? error.message : String(error)
          publishNotice(t('notice.failed', { reason }))
        }

        /** Close the chooser without starting anything. */
        function closePanel() {
          const state = panelStore.get()
          if (!state.open) return
          panelStore.set({ ...state, open: false })
        }

        /** Toggle the chooser from the "+" menu entry. */
        function togglePanel() {
          const state = panelStore.get()
          if (state.open) {
            closePanel()
            return
          }
          // The chooser owns the space above the composer while it is open.
          publishNotice('')
          panelStore.set({ open: true, hideWindow: readHideWindow() })
        }

        /** Attach one captured PNG as a draft image. */
        function attachBlob(blob) {
          pasteIntoComposer(
            [new File([blob], `screenshot-${fileStamp()}.png`, { type: 'image/png' })],
            t('notice.refused'),
          )
        }

        /**
         * Ask the Host for one capture. The Host captures on the real screen,
         * so this call is what shows the snip overlay on the desktop.
         * @param mode - `region` for an on-screen area, `full` for everything.
         * @returns the captured PNG, or null when the user cancelled the area.
         */
        async function fetchCapture(mode) {
          const hide = readHideWindow() ? '1' : '0'
          // The overlay shows exactly one line of its own; the copy lives here
          // so it follows the active locale.
          const hint = encodeURIComponent(capsStore.get().annotate ? t('overlay.hint') : t('overlay.hintPlain'))
          const response = await fetch(
            `${CAPTURE_ENDPOINT}?mode=${mode}&hide=${hide}&hint=${hint}`,
            { cache: 'no-store', credentials: 'same-origin' },
          )
          if (response.status === 204) return null
          if (!response.ok) {
            const detail = await response.text().catch(() => '')
            let reason = ''
            try {
              const parsed = JSON.parse(detail)
              if (typeof parsed === 'object' && parsed !== null && typeof parsed.error === 'string') reason = parsed.error
            } catch {
              reason = ''
            }
            throw new Error(reason === '' ? t('notice.badResponse', { status: response.status }) : reason)
          }
          const mediaType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
          if (!mediaType.startsWith('image/')) throw new Error(t('notice.badResponse', { status: response.status }))
          const blob = await response.blob()
          if (blob.size === 0) throw new Error(t('notice.badResponse', { status: response.status }))
          return blob
        }

        /**
         * Capture and attach. One run at a time: a second request joins the
         * first instead of opening a second snip overlay.
         * @param mode - `region` or `full`.
         */
        async function startCapture(mode) {
          closePanel()
          if (captureRun !== null) return
          publishNotice('')
          busyStore.set(true)
          captureRun = (async () => {
            try {
              if (composerCard() === null) throw new Error(t('notice.noComposer'))
              const blob = await fetchCapture(mode)
              if (blob !== null) attachBlob(blob)
            } catch (error) {
              reportFailure(error)
            } finally {
              busyStore.set(false)
              captureRun = null
            }
          })()
          await captureRun
        }

        function CaptureButton() {
          const busy = useStore(busyStore)
          const [, force] = React.useReducer(count => count + 1, 0)
          React.useEffect(() => ctx.locale.subscribe(() => { force() }), [])
          const label = busy ? t('button.busy') : t('button.label')
          return h('button', {
            type: 'button',
            className: CLASS + '-button',
            title: label,
            'aria-label': label,
            'aria-busy': busy,
            disabled: busy,
            onMouseDown: event => { event.preventDefault() },
            onClick: () => { if (!busy) void startCapture('region') },
          }, busy ? h(CameraBusyIcon, { size: 14 }) : h(CameraIcon, { size: 14 }))
        }

        function CapturePanel() {
          const state = useStore(panelStore)
          const busy = useStore(busyStore)
          const caps = useStore(capsStore)
          const hostRef = React.useRef(null)
          const [, force] = React.useReducer(count => count + 1, 0)
          React.useEffect(() => ctx.locale.subscribe(() => { force() }), [])
          React.useEffect(() => {
            if (!state.open) return undefined
            const onPointerDown = (event) => {
              const target = event.target
              const host = hostRef.current
              if (host !== null && target instanceof Node && host.contains(target)) return
              closePanel()
            }
            const onKeyDown = (event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              closePanel()
            }
            document.addEventListener('pointerdown', onPointerDown, true)
            window.addEventListener('keydown', onKeyDown, true)
            return () => {
              document.removeEventListener('pointerdown', onPointerDown, true)
              window.removeEventListener('keydown', onKeyDown, true)
            }
          }, [state.open])
          if (!state.open) return null
          return h('div', {
            ref: hostRef,
            className: CLASS + '-panel',
            role: 'group',
            'aria-label': t('panel.label'),
          },
            h('button', {
              type: 'button',
              className: CLASS + '-panel-item',
              disabled: busy,
              onClick: () => { void startCapture('region') },
            }, h(CameraIcon, { size: 14 }), h('span', null, t('panel.region'))),
            h('button', {
              type: 'button',
              className: CLASS + '-panel-item',
              disabled: busy,
              onClick: () => { void startCapture('full') },
            }, h(CameraIcon, { size: 14 }), h('span', null, t('panel.full'))),
            caps.hideWindow ? h('label', { className: CLASS + '-panel-check' },
              h('input', {
                type: 'checkbox',
                checked: state.hideWindow,
                onChange: (event) => {
                  writeHideWindow(event.target.checked)
                  panelStore.set({ ...panelStore.get(), hideWindow: event.target.checked })
                },
              }),
              h('span', null, t('panel.hide'))) : null)
        }

        function Notice() {
          const current = useStore(noticeStore)
          React.useEffect(() => {
            if (current === null) return undefined
            const timer = setTimeout(() => { retireNotice(current.seq) }, NOTICE_HOLD_ERROR_MS)
            return () => { clearTimeout(timer) }
          }, [current])
          if (current === null) return null
          return h('div', { className: CLASS + '-notice', role: 'alert' },
            h('span', { className: CLASS + '-notice-dot', 'aria-hidden': true }),
            h('span', null, current.text))
        }

        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'screenshot',
          order: 10,
        }, CaptureButton))

        // Two entries in one owner: the chooser and the failure notice.
        ctx.slots.inject('conversation.input.overlay', function* () {
          yield ctx.slots.register({
            name: 'conversation.input.overlay',
            id: 'screenshot-panel',
            order: 70,
          }, CapturePanel)
          yield ctx.slots.register({
            name: 'conversation.input.overlay',
            id: 'screenshot-notice',
            order: 80,
          }, Notice)
        })

        ctx.inject(['commandUi'], scope => {
          scope.effect(() => scope.commandUi.register({
            name: 'screenshot',
            label: () => t('command.label'),
            description: () => t('command.description'),
            icon: CameraIcon,
            available: () => true,
            ui: {
              kind: 'action',
              run: () => { togglePanel() },
            },
          }), 'dsh-screenshot-loupe: command')
        })
      },
    }
  },
})

