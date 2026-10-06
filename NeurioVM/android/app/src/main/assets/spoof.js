/*
 * NeurioVM — guest-side identity layer.
 *
 * Injected by SpoofScript into every frame of the isolated browser, right after
 * `window.__NEURIO__ = {...}` has been defined. Its job is to make the DOM APIs
 * that fingerprinting scripts read agree with the synthetic handset described by
 * the config object — and, just as important, agree with *each other*. A spoof
 * that changes navigator.userAgent but leaves screen.width at the host's value
 * is worse than no spoof at all, because the mismatch is itself a fingerprint.
 *
 * Layers, in the order they matter in practice:
 *   1. navigator             UA, platform, language(s), cores, memory, touch
 *   2. navigator.userAgentData    Client Hints incl. getHighEntropyValues()
 *   3. screen / window        CSS-pixel geometry, DPR, colour depth, media queries
 *   4. Intl / Date            IANA timezone, UTC offset, locale-formatted dates
 *   5. WebGL                  UNMASKED_VENDOR/RENDERER + the numeric limits
 *   6. Canvas                 deterministic per-device pixel noise
 *   7. AudioContext           deterministic per-device sample noise
 *   8. Battery / network / media devices / storage quota
 *   9. WebRTC                 local-address redaction in the SDP
 *
 * Determinism: the noise is seeded from the device's ANDROID_ID, so one virtual
 * handset always produces the same canvas and audio hash — exactly what a real
 * device does — while two virtual handsets produce different ones.
 *
 * Every override is wrapped in try/catch. A page that has already frozen
 * `navigator` must not be able to break the browser; the failure is recorded in
 * window.__NEURIO_APPLIED__ and surfaced in the app UI instead.
 */
(function () {
    'use strict';

    var C = window.__NEURIO__;
    if (!C) { return; }

    var log = function (msg) {
        try {
            if (window.NeurioVM && typeof window.NeurioVM.log === 'function') {
                window.NeurioVM.log(String(msg));
            }
        } catch (e) { /* the native bridge is attached after this script runs */ }
    };

    /* ── deterministic PRNG (mulberry32) ─────────────────────────────────── */
    function prng(seed) {
        var a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    var rnd = prng(C.seed >>> 0);

    /* ── helpers ─────────────────────────────────────────────────────────── */
    function define(obj, prop, value) {
        if (!obj) { return false; }
        try {
            Object.defineProperty(obj, prop, {
                value: value, writable: false, enumerable: true, configurable: true
            });
            return true;
        } catch (e) {
            try { obj[prop] = value; return true; } catch (e2) { return false; }
        }
    }

    /**
     * Replaces `proto[method]` with a wrapper.
     * The callback is invoked as `cb.call(thisObj, arguments, originalFn)`.
     */
    function patch(obj, method, cb) {
        try {
            if (!obj || typeof obj[method] !== 'function') { return false; }
            var orig = obj[method];
            var wrapped = function () { return cb.call(this, arguments, orig); };
            Object.defineProperty(wrapped, 'name', { value: method, configurable: true });
            wrapped.toString = function () { return 'function ' + method + '() { [native code] }'; };
            obj[method] = wrapped;
            return obj[method] === wrapped;
        } catch (e) {
            return false; /* frozen or read-only */
        }
    }

    var applied = [];
    function ok(name, done) { applied.push((done ? '+' : '-') + name); }

    /* ══ 1. navigator ═════════════════════════════════════════════════════ */
    var nav = window.navigator;
    if (C.jsApi) {
        if (C.userAgent) {
            ok('navigator.userAgent', define(nav, 'userAgent', C.userAgent));
            ok('navigator.appVersion', define(nav, 'appVersion', C.userAgent.replace('Mozilla/', '')));
        } else {
            ok('navigator.userAgent', false);
            ok('navigator.appVersion', false);
        }
        ok('navigator.platform', define(nav, 'platform', 'Linux armv8l'));
        ok('navigator.vendor', define(nav, 'vendor', 'Google Inc.'));
        ok('navigator.product', define(nav, 'product', 'Gecko'));
        ok('navigator.productSub', define(nav, 'productSub', '20030107'));
        ok('navigator.vendorSub', define(nav, 'vendorSub', ''));
        ok('navigator.language', define(nav, 'language', C.language));
        ok('navigator.languages', define(nav, 'languages', Object.freeze(C.languages.slice())));
        ok('navigator.hardwareConcurrency', define(nav, 'hardwareConcurrency', C.cores));
        ok('navigator.deviceMemory', define(nav, 'deviceMemory', C.deviceMemory));
        ok('navigator.maxTouchPoints', define(nav, 'maxTouchPoints', C.maxTouchPoints));
        ok('navigator.doNotTrack', define(nav, 'doNotTrack', null));
        ok('navigator.webdriver', define(nav, 'webdriver', false));
        ok('navigator.pdfViewerEnabled', define(nav, 'pdfViewerEnabled', true));
        if (!window.chrome) { define(window, 'chrome', { runtime: {}, loadTimes: function () {}, csi: function () {} }); }
        ok('window.chrome', true);

        /* ── 2. Client Hints ────────────────────────────────────────────── */
        if (C.userAgentData) {
            var U = C.userAgentData;
            var uad = {
                brands: U.brands,
                mobile: U.mobile,
                platform: U.platform,
                toJSON: function () {
                    return { brands: U.brands, mobile: U.mobile, platform: U.platform };
                },
                getHighEntropyValues: function (hints) {
                    var out = { brands: U.brands, mobile: U.mobile, platform: U.platform };
                    var want = hints || [];
                    for (var i = 0; i < want.length; i++) {
                        switch (want[i]) {
                            case 'architecture':    out.architecture = U.architecture; break;
                            case 'bitness':         out.bitness = U.bitness; break;
                            case 'model':           out.model = U.model; break;
                            case 'platformVersion': out.platformVersion = U.platformVersion; break;
                            case 'uaFullVersion':   out.uaFullVersion = U.uaFullVersion; break;
                            case 'fullVersionList': out.fullVersionList = U.fullVersionList; break;
                            case 'wow64':           out.wow64 = false; break;
                            case 'formFactors':     out.formFactors = [U.formFactor]; break;
                            default: break;
                        }
                    }
                    return Promise.resolve(out);
                }
            };
            ok('navigator.userAgentData', define(nav, 'userAgentData', uad));
        }

        /* ── 3. screen / window geometry (CSS pixels, as Chrome reports) ── */
        var S = C.screen;
        ok('screen.width', define(window.screen, 'width', S.width));
        ok('screen.height', define(window.screen, 'height', S.height));
        ok('screen.availWidth', define(window.screen, 'availWidth', S.availWidth));
        ok('screen.availHeight', define(window.screen, 'availHeight', S.availHeight));
        ok('screen.availLeft', define(window.screen, 'availLeft', 0));
        ok('screen.availTop', define(window.screen, 'availTop', 0));
        ok('screen.left', define(window.screen, 'left', 0));
        ok('screen.top', define(window.screen, 'top', 0));
        ok('screen.colorDepth', define(window.screen, 'colorDepth', S.colorDepth));
        ok('screen.pixelDepth', define(window.screen, 'pixelDepth', S.pixelDepth));
        try {
            if (window.screen && window.screen.orientation) {
                define(window.screen.orientation, 'type', S.portrait ? 'portrait-primary' : 'landscape-primary');
                define(window.screen.orientation, 'angle', S.portrait ? 0 : 90);
                ok('screen.orientation', true);
            } else { ok('screen.orientation', false); }
        } catch (e) { ok('screen.orientation', false); }

        ok('window.devicePixelRatio', define(window, 'devicePixelRatio', S.dpr));
        ok('window.outerWidth', define(window, 'outerWidth', S.width));
        ok('window.outerHeight', define(window, 'outerHeight', S.height));
        ok('window.screenX', define(window, 'screenX', 0));
        ok('window.screenY', define(window, 'screenY', 0));
        ok('window.screenLeft', define(window, 'screenLeft', 0));
        ok('window.screenTop', define(window, 'screenTop', 0));

        /* Media queries are a second, indirect read of the viewport size. */
        try {
            var origMatch = window.matchMedia ? window.matchMedia.bind(window) : null;
            if (origMatch) {
                var TRUE_Q = '(min-width: 1px)';
                var FALSE_Q = '(max-width: 0px)';
                window.matchMedia = function (q) {
                    var s = String(q);
                    if (/[wd]idth|[h]eight/.test(s)) {
                        s = s.replace(
                            /\(\s*(min|max)-(device-)?(width|height)\s*:\s*([\d.]+)(px|em|rem|cm|mm|in|pt|pc)\s*\)/g,
                            function (m, kind, _dev, dim, val, unit) {
                                var px = toPx(parseFloat(val), unit);
                                var actual = dim === 'width' ? S.width : S.height;
                                var hit = (kind === 'min') ? actual >= px : actual <= px;
                                return hit ? TRUE_Q : FALSE_Q;
                            });
                    }
                    return origMatch(s);
                };
                window.matchMedia.toString = function () { return 'function matchMedia() { [native code] }'; };
                ok('window.matchMedia', true);
            } else { ok('window.matchMedia', false); }
        } catch (e) { ok('window.matchMedia', false); }

        function toPx(v, unit) {
            switch (unit) {
                case 'em': case 'rem': return v * 16;
                case 'cm': return v * 96 / 2.54;
                case 'mm': return v * 96 / 25.4;
                case 'in': return v * 96;
                case 'pt': return v * 96 / 72;
                case 'pc': return v * 16;
                default: return v;
            }
        }
    }

    /* ══ 4. timezone ══════════════════════════════════════════════════════ */
    if (C.timezone) {
        var TZ = C.timezone.id;
        var OFFSET = C.timezone.offsetMinutes;   // Date semantics: minutes WEST of UTC
        var OrigDTF = Intl.DateTimeFormat;       // captured before any patching

        ok('Intl.DateTimeFormat.resolvedOptions', patch(OrigDTF.prototype, 'resolvedOptions',
            function (args, orig) {
                var o = orig.call(this);
                o.timeZone = TZ;
                return o;
            }));

        function pad2(n) { return (n < 10 ? '0' : '') + n; }

        function gmtToken() {
            var sign = OFFSET <= 0 ? '+' : '-';
            var abs = Math.abs(OFFSET);
            return 'GMT' + sign + pad2(Math.floor(abs / 60)) + pad2(abs % 60);
        }

        function zonedParts(date) {
            var f = new OrigDTF('en-US', {
                timeZone: TZ, weekday: 'short', year: 'numeric', month: 'short',
                day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
                hourCycle: 'h23'
            });
            var p = {};
            var parts = f.formatToParts(date);
            for (var i = 0; i < parts.length; i++) { p[parts[i].type] = parts[i].value; }
            if (p.hour === '24') { p.hour = '00'; }
            return p;
        }

        /* These four print a literal timezone name/offset, so they are rebuilt
         * from Intl rather than string-mangled — mangling leaves the hour wrong. */
        ok('Date.toString', patch(Date.prototype, 'toString', function (args, orig) {
            try {
                var p = zonedParts(this);
                return p.weekday + ' ' + p.month + ' ' + p.day + ' ' + p.year + ' ' +
                       p.hour + ':' + p.minute + ':' + p.second + ' ' + gmtToken() + ' (' + TZ + ')';
            } catch (e) { return orig.call(this); }
        }));
        ok('Date.toTimeString', patch(Date.prototype, 'toTimeString', function (args, orig) {
            try {
                var p = zonedParts(this);
                return p.hour + ':' + p.minute + ':' + p.second + ' ' + gmtToken() + ' (' + TZ + ')';
            } catch (e) { return orig.call(this); }
        }));
        ok('Date.toDateString', patch(Date.prototype, 'toDateString', function (args, orig) {
            try {
                var p = zonedParts(this);
                return p.weekday + ' ' + p.month + ' ' + p.day + ' ' + p.year;
            } catch (e) { return orig.call(this); }
        }));
        ok('Date.getTimezoneOffset', patch(Date.prototype, 'getTimezoneOffset', function () {
            return OFFSET;
        }));

        /* The locale formatters only need a default timeZone injected; an
         * explicit one supplied by the page is respected, because that is what
         * a real handset does too. */
        function withTz(opts) {
            var o = {};
            if (opts && typeof opts === 'object') {
                for (var k in opts) { if (Object.prototype.hasOwnProperty.call(opts, k)) { o[k] = opts[k]; } }
            }
            if (!o.timeZone) { o.timeZone = TZ; }
            return o;
        }
        ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].forEach(function (m) {
            ok('Date.' + m, patch(Date.prototype, m, function (args, orig) {
                try {
                    var loc = args.length > 0 ? args[0] : C.localeTag;
                    return orig.call(this, loc || C.localeTag, withTz(args.length > 1 ? args[1] : null));
                } catch (e) { return orig.apply(this, args); }
            }));
        });
    }

    /* ══ 5. WebGL ═════════════════════════════════════════════════════════ */
    if (C.webgl) {
        var UNMASKED_VENDOR = 0x9245, UNMASKED_RENDERER = 0x9246;
        var LIMITS = C.webgl.limits || {};

        function hookGl(proto) {
            if (!proto) { return false; }
            var a = patch(proto, 'getParameter', function (args, orig) {
                var p = args[0];
                switch (p) {
                    case UNMASKED_VENDOR: return C.webgl.vendor;
                    case UNMASKED_RENDERER: return C.webgl.renderer;
                    case 0x1F00: return 'WebKit';
                    case 0x1F01: return 'WebKit WebGL';
                    case 0x1F02: return C.webgl.glVersion;
                    case 0x8B8C: return C.webgl.shadingLanguage;
                    case 0x0D33: return LIMITS.maxTextureSize;
                    case 0x851C: return LIMITS.maxCubeMap;
                    case 0x8DFB: return LIMITS.maxVertexAttribs;
                    case 0x8DFC: return LIMITS.maxVaryingVectors;
                    case 0x8B4C: return LIMITS.maxVertexUniforms;
                    case 0x8B49: return LIMITS.maxFragmentUniforms;
                    case 0x8872: return LIMITS.maxTextureImageUnits;
                    case 0x8869: return LIMITS.maxCombinedTextures;
                    case 0x0D3A: return [Math.max(C.screen.width, C.screen.height),
                                         Math.max(C.screen.width, C.screen.height)];
                    default: return orig.apply(this, args);
                }
            });
            var b = patch(proto, 'getExtension', function (args, orig) {
                var e = orig.apply(this, args);
                if (!e && args[0] === 'WEBGL_debug_renderer_info') {
                    return { UNMASKED_VENDOR_WEBGL: UNMASKED_VENDOR,
                             UNMASKED_RENDERER_WEBGL: UNMASKED_RENDERER };
                }
                return e;
            });
            var c = patch(proto, 'getSupportedExtensions', function (args, orig) {
                var l = orig.apply(this, args) || [];
                if (l.indexOf('WEBGL_debug_renderer_info') < 0) { l.push('WEBGL_debug_renderer_info'); }
                return l;
            });
            return a || b || c;
        }

        var d1 = hookGl(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype);
        var d2 = hookGl(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype);
        ok('WebGL.getParameter', d1 || d2);
    }

    /* ══ 6. Canvas fingerprint noise ══════════════════════════════════════ */
    if (C.canvas) {
        var AMP = C.canvas.amplitude;        // 1..4 least-significant bits
        var COVERAGE = C.canvas.coverage;    // 0..1 share of pixels touched

        function noiseFor(x, y, c) {
            var h = (C.seed ^ Math.imul(x + 1, 0x9E3779B1) ^ Math.imul(y + 1, 0x85EBCA6B)
                     ^ Math.imul(c + 1, 0xC2B2AE35)) >>> 0;
            h ^= h >>> 15; h = Math.imul(h, 0x2545F491); h ^= h >>> 13;
            return ((h >>> 0) % (AMP * 2 + 1)) - AMP;
        }

        function perturb(imageData) {
            if (!imageData || !imageData.data) { return imageData; }
            var px = imageData.data, n = px.length / 4;
            var step = COVERAGE > 0 ? Math.max(1, Math.round(1 / COVERAGE)) : 1;
            for (var i = 0; i < n; i += step) {
                var x = i % imageData.width, y = (i / imageData.width) | 0;
                for (var c = 0; c < 3; c++) {
                    var idx = i * 4 + c;
                    var v = px[idx] + noiseFor(x, y, c);
                    px[idx] = v < 0 ? 0 : (v > 255 ? 255 : v);
                }
            }
            return imageData;
        }

        ok('CanvasRenderingContext2D.getImageData', patch(
            window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype,
            'getImageData', function (args, orig) { return perturb(orig.apply(this, args)); }));

        /* toDataURL/toBlob read the backing store directly, so they cannot be
         * perturbed after the fact. Instead an invisible, device-specific
         * pattern is stamped onto the canvas before the page reads it. */
        function stamp(canvas) {
            try {
                if (!canvas || canvas.__neurioStamped) { return; }
                var ctx = canvas.getContext('2d');
                if (!ctx) { return; }                 // WebGL canvas — layer 5 covers it
                canvas.__neurioStamped = true;
                var w = canvas.width, h = canvas.height;
                if (!w || !h) { return; }
                ctx.save();
                ctx.globalAlpha = C.canvas.alpha;      // ~0.004: below one 8-bit step
                ctx.fillStyle = C.canvas.stampColor;   // per-device hue
                var n = Math.max(8, Math.min(C.canvas.dots, (w * h) / 64));
                for (var i = 0; i < n; i++) {
                    ctx.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1, 1);
                }
                ctx.restore();
            } catch (e) { /* tainted or detached canvas */ }
        }

        ok('HTMLCanvasElement.toDataURL', patch(
            window.HTMLCanvasElement && window.HTMLCanvasElement.prototype, 'toDataURL',
            function (args, orig) { stamp(this); return orig.apply(this, args); }));
        ok('HTMLCanvasElement.toBlob', patch(
            window.HTMLCanvasElement && window.HTMLCanvasElement.prototype, 'toBlob',
            function (args, orig) { stamp(this); return orig.apply(this, args); }));
        ok('OffscreenCanvas.convertToBlob', patch(
            window.OffscreenCanvas && window.OffscreenCanvas.prototype, 'convertToBlob',
            function (args, orig) { stamp(this); return orig.apply(this, args); }));
    }

    /* ══ 7. AudioContext fingerprint noise ════════════════════════════════ */
    if (C.audio) {
        var AAMP = C.audio.amplitude;

        function hashOf(i, salt) {
            var h = (C.seed ^ Math.imul(i + salt, 0x9E3779B1)) >>> 0;
            h ^= h >>> 16; h = Math.imul(h, 0x7FEB352D); h ^= h >>> 15;
            return h >>> 0;
        }

        var AP = window.AnalyserNode && window.AnalyserNode.prototype;
        ok('AnalyserNode.getFloatFrequencyData', patch(AP, 'getFloatFrequencyData',
            function (args, orig) {
                orig.apply(this, args);
                var arr = args[0];
                if (!arr) { return; }
                for (var i = 0; i < arr.length; i++) {
                    if (arr[i] === -Infinity) { continue; }
                    arr[i] += ((hashOf(i, 1) % 2001) - 1000) / 1000 * AAMP;
                }
            }));
        ok('AnalyserNode.getByteFrequencyData', patch(AP, 'getByteFrequencyData',
            function (args, orig) {
                orig.apply(this, args);
                var arr = args[0];
                if (!arr) { return; }
                for (var i = 0; i < arr.length; i++) {
                    arr[i] = Math.max(0, Math.min(255, arr[i] + (hashOf(i, 7) % 3) - 1));
                }
            }));
        /* The canonical AudioContext fingerprint hashes an OfflineAudioContext
         * render, which surfaces through AudioBuffer.getChannelData(). */
        ok('AudioBuffer.getChannelData', patch(
            window.AudioBuffer && window.AudioBuffer.prototype, 'getChannelData',
            function (args, orig) {
                var buf = orig.apply(this, args);
                if (!C.audio.touchRender || !buf) { return buf; }
                for (var i = 0; i < buf.length; i += 97) {
                    buf[i] += ((hashOf(i, 3) % 2001) - 1000) / 1000 * AAMP;
                }
                return buf;
            }));
    }

    /* ══ 8. battery / network / media devices / storage ═══════════════════ */
    if (C.battery && nav.getBattery) {
        ok('navigator.getBattery', patch(nav, 'getBattery', function () {
            var b = C.battery;
            return Promise.resolve({
                charging: b.charging,
                chargingTime: b.charging ? 1800 : Infinity,
                dischargingTime: b.charging ? Infinity : 10800,
                level: b.level,
                onchargingchange: null, onchargingtimechange: null,
                ondischargingtimechange: null, onlevelchange: null,
                addEventListener: function () {}, removeEventListener: function () {},
                dispatchEvent: function () { return true; }
            });
        }));
    }

    if (C.network) {
        var conn = Object.freeze({
            effectiveType: C.network.effectiveType,
            downlink: C.network.downlink,
            rtt: C.network.rtt,
            saveData: false,
            onchange: null,
            addEventListener: function () {},
            removeEventListener: function () {},
            dispatchEvent: function () { return true; }
        });
        ok('navigator.connection', define(nav, 'connection', conn) || define(nav, 'mozConnection', conn));
    }

    if (C.mediaDevices && nav.mediaDevices) {
        ok('mediaDevices.enumerateDevices', patch(nav.mediaDevices, 'enumerateDevices', function () {
            var list = [];
            for (var i = 0; i < C.mediaDevices.length; i++) {
                (function (d) {
                    list.push({
                        deviceId: d.deviceId, groupId: d.groupId, kind: d.kind, label: d.label,
                        toJSON: function () {
                            return { deviceId: d.deviceId, groupId: d.groupId, kind: d.kind, label: d.label };
                        }
                    });
                })(C.mediaDevices[i]);
            }
            return Promise.resolve(list);
        }));
    }

    if (C.storage && nav.storage && nav.storage.estimate) {
        ok('navigator.storage.estimate', patch(nav.storage, 'estimate', function () {
            return Promise.resolve({ quota: C.storage.quota, usage: C.storage.usage });
        }));
    }

    /* ══ 9. WebRTC local-address redaction ════════════════════════════════ */
    if (C.webrtc && window.RTCPeerConnection) {
        var MASK = C.webrtc.maskIp;
        function mangleSdp(sdp) {
            if (typeof sdp !== 'string' || !sdp) { return sdp; }
            var lines = sdp.split('\r\n'), out = [];
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                if (line.indexOf('a=candidate:') === 0) {
                    /* drop the host candidate: it is the one carrying the LAN IP */
                    if (/\styp\shost\s/.test(line)) { continue; }
                    out.push(line.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, MASK));
                } else if (line.indexOf('c=IN IP4 ') === 0) {
                    out.push('c=IN IP4 ' + MASK);
                } else if (line.indexOf('c=IN IP6 ') === 0) {
                    out.push('c=IN IP6 ' + (C.webrtc.maskIpv6 || '0:0:0:0:0:0:0:1'));
                } else {
                    out.push(line);
                }
            }
            return out.join('\r\n');
        }
        var a1 = patch(window.RTCPeerConnection.prototype, 'createOffer', function (args, orig) {
            return orig.apply(this, args).then(function (desc) {
                try { return desc && desc.sdp ? { type: desc.type, sdp: mangleSdp(desc.sdp) } : desc; }
                catch (e) { return desc; }
            });
        });
        var a2 = patch(window.RTCPeerConnection.prototype, 'createAnswer', function (args, orig) {
            return orig.apply(this, args).then(function (desc) {
                try { return desc && desc.sdp ? { type: desc.type, sdp: mangleSdp(desc.sdp) } : desc; }
                catch (e) { return desc; }
            });
        });
        ok('RTCPeerConnection SDP', a1 || a2);
    }

    /* ══ reporting ════════════════════════════════════════════════════════ */
    window.__NEURIO_APPLIED__ = applied;
    window.__NEURIO_REPORT__ = function () {
        var webgl = null;
        try {
            var cv = document.createElement('canvas');
            var gl = cv.getContext('webgl') || cv.getContext('experimental-webgl');
            if (gl) {
                var ext = gl.getExtension('WEBGL_debug_renderer_info');
                webgl = {
                    vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null,
                    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null
                };
            }
        } catch (e) { /* no GL context */ }

        var tz = null;
        try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}

        return {
            device: C.device,
            userAgent: nav.userAgent,
            platform: nav.platform,
            language: nav.language,
            languages: nav.languages,
            hardwareConcurrency: nav.hardwareConcurrency,
            deviceMemory: nav.deviceMemory,
            maxTouchPoints: nav.maxTouchPoints,
            screen: {
                width: window.screen.width, height: window.screen.height,
                availWidth: window.screen.availWidth, availHeight: window.screen.availHeight,
                colorDepth: window.screen.colorDepth, dpr: window.devicePixelRatio
            },
            timezone: tz,
            timezoneOffsetMinutes: new Date().getTimezoneOffset(),
            localeString: new Date(0).toLocaleString(),
            dateToString: new Date().toString(),
            webgl: webgl,
            battery: (nav.getBattery ? 'available' : 'absent'),
            layers: applied
        };
    };

    var active = 0;
    for (var i = 0; i < applied.length; i++) { if (applied[i].charAt(0) === '+') { active++; } }
    log('identity applied: ' + C.device + ' — ' + active + '/' + applied.length + ' layers active');
})();
