// The one Engine instance the process has, reachable from more than one bridge.
//
// v4k_jni.cpp owns a file-static Engine behind a mutex for the SDK bridge
// (com.aivision4k.sdk.NativeBridge). The demo bridge (demo/v4k_demo_jni.cpp)
// needs the *same* instance rather than one of its own, for two reasons that are
// about correctness, not tidiness:
//
//   * the model the AI Engine screen installed is the model the demo upscales
//     with -- two Engines would mean "a model is installed" on one screen and
//     "no model" on the other, with no way for the user to understand why;
//   * a second Engine probes the device again and can disagree with the
//     compatibility verdict the rest of the app is showing.
//
// The declaration lives in its own header so both translation units agree on it
// and a rename is a compile error rather than a link error.
#pragma once

#include <jni.h>

namespace v4k {

class Engine;

// Never null. The engine may not be initialised yet: the caller checks
// `initialised()` before using it.
Engine* sharedEngineForDemo();


// Registers the demo activity's natives (com.aivision4k.app.DemoNativeBridge).
//
// A shared library is allowed exactly one JNI_OnLoad, and only one is called on
// load, so this is invoked from the SDK bridge's JNI_OnLoad rather than having a
// second one here -- two definitions would be a duplicate symbol, and a second
// JNI_OnLoad that never runs would leave every demo method unbound with a
// UnsatisfiedLinkError at the first click.
//
}  // namespace v4k

// C linkage and global scope: this crosses a translation unit boundary, and a
// namespace would only invite a `v4k::` qualifier at the call site that means
// nothing to the linker.
//
// Only compiled and only called when the demo bridge is in the build
// (V4K_ENABLE_DEMO); returns false when the Kotlin class cannot be found.
extern "C" bool v4kRegisterDemoBridge(JNIEnv* env);
