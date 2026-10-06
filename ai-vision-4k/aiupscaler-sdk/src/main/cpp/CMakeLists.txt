# Native build for the AI Vision 4K engine.
#
# Produces one shared library per ABI (libaivision4k.so) that contains the
# whole engine: platform probing, profiles/thermal policy, image and metric
# code, the AI model runtime, the Vulkan backend and (later) the JNI bridge and
# the demo renderer. A game that integrates the SDK ships exactly this .so and
# never compiles C++ itself.
#
# Options, all passed by Gradle (see aiupscaler-sdk/build.gradle.kts) and safe
# to set by hand:
#   V4K_ENABLE_VULKAN   ON   Vulkan backend, renderer and compute pipeline
#   V4K_ENABLE_NNAPI    ON   NNAPI backend (skipped automatically when the
#                             device NDK has no libneuralnetworks stub)
#   V4K_BUILD_TESTS     OFF  host/on-device test binary; the host suite is run
#                             by tools/run-native-tests.sh (which compiles the
#                             sources directly and does not need CMake)
#   V4K_DEBUG_CHECKS    ON   expensive argument validation; always defined as
#                             0 or 1, so code tests it with `#if V4K_DEBUG_CHECKS`
#
# The Vulkan sources are guarded by `#if defined(V4K_ENABLE_VULKAN)`, so with
# the option off the engine still builds and the compatibility engine reports
# "no Vulkan support in this build" instead of failing to link.
cmake_minimum_required(VERSION 3.22.1)

project(aivision4k LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

option(V4K_ENABLE_VULKAN "Build the Vulkan backend" ON)
option(V4K_ENABLE_NNAPI "Build the NNAPI backend" ON)
option(V4K_BUILD_TESTS "Also build the native test executable" OFF)
option(V4K_DEBUG_CHECKS "Enable expensive runtime checks" ON)

if(NOT ANDROID)
    message(STATUS
        "Not an Android build: only the test target is expected to work "
        "(the renderer needs ANativeWindow and the Vulkan loader).")
endif()

# ---------------------------------------------------------------------------
# Shaders
#
# The subdirectory embeds the checked-in SPIR-V blobs into a generated header at
# configure time and publishes its path through V4K_SHADER_EMBED_HEADER. No
# shader compiler is needed to build the engine; tools/shaders/build-shaders.js
# regenerates the .spv files and they are committed.
# ---------------------------------------------------------------------------
add_subdirectory(shaders)
get_filename_component(V4K_SHADER_EMBED_DIR "${V4K_SHADER_EMBED_HEADER}" DIRECTORY)

# ---------------------------------------------------------------------------
# Sources
#
# Listed explicitly (no globbing): a source file that is dropped from the build
# must be a visible diff, not a silently missing symbol.
# ---------------------------------------------------------------------------
set(V4K_CORE_SOURCES
    core/v4k_common.cpp
    core/v4k_json.cpp
    core/v4k_sha256.cpp
    core/v4k_image.cpp
    core/v4k_profile.cpp
    core/v4k_device.h          # header-only: capability structs + helpers
    core/v4k_metrics.cpp
    core/v4k_thermal.cpp
    core/v4k_compat.cpp
)

set(V4K_AI_SOURCES
    ai/v4k_model.cpp
    ai/v4k_model_catalog.cpp
    ai/v4k_cpu_infer.cpp
    ai/v4k_gpu_plan.cpp
)

# The demo scene's device-independent half: meshes, instances, camera, light and
# the CPU mirror of the particle simulation. No Vulkan types, so it is compiled
# into every configuration and covered by the host test suite.
set(V4K_GRAPHICS_SOURCES
    graphics/v4k_scene.cpp
)

set(V4K_VULKAN_SOURCES
    vulkan/v4k_device_probe.cpp      # provides the "no Vulkan" stub too
    vulkan/v4k_shader_registry.cpp   # pure SPIR-V plumbing, no Vulkan types
)

if(V4K_ENABLE_VULKAN)
    # Only these declare Vulkan-typed objects (v4k_vk_pipeline.h even #errors
    # without the backend), so they are part of the Vulkan build and nothing else.
    list(APPEND V4K_VULKAN_SOURCES
        vulkan/v4k_vk_core.cpp
        vulkan/v4k_vk_resources.cpp
        vulkan/v4k_vk_swapchain.cpp
        vulkan/v4k_vk_pipeline.cpp
    )
endif()

# The SDK façade: the object the JNI bridge owns and the Kotlin `AIUpscaler`
# API wraps. Platform independent apart from the Vulkan session it can host.
set(V4K_SDK_SOURCES
    sdk/v4k_engine.cpp
)

# The JNI bridge needs <jni.h>. The NDK provides it for Android builds; a host
# build compiles it too when V4K_JNI_INCLUDE_DIRS points at a JDK's
# share/native/include and unix/native/include directories (this is what makes a
# full compile of jni/v4k_jni.cpp possible without a device or the NDK).
set(V4K_JNI_INCLUDE_DIRS "" CACHE STRING
    "JDK include directories holding jni.h and jni_md.h (host builds of the JNI bridge)")
if(ANDROID OR V4K_JNI_INCLUDE_DIRS)
    list(APPEND V4K_SDK_SOURCES
        jni/v4k_jni.cpp
    )
    if(NOT ANDROID)
        include_directories(${V4K_JNI_INCLUDE_DIRS})
    endif()
endif()

set(V4K_ENGINE_SOURCES
    ${V4K_CORE_SOURCES}
    ${V4K_AI_SOURCES}
    ${V4K_GRAPHICS_SOURCES}
    ${V4K_VULKAN_SOURCES}
    ${V4K_SDK_SOURCES}
)

# The demo renderer (demo/v4k_demo_renderer.cpp) and its JNI bridge are Vulkan-
# only and are added here as they land, following the Vulkan backend in and out
# of the build. The device-independent half of the scene lives in
# V4K_GRAPHICS_SOURCES above and is always compiled and tested.

# The lists above are explicit so that dropping a file is a visible diff; this
# makes a *typo* fail at configure time instead of turning into a missing symbol
# three minutes into a Gradle build.
foreach(source ${V4K_ENGINE_SOURCES} ${V4K_TEST_SOURCES})
    if(source MATCHES "\\.(cpp|c)$")
        if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/${source}")
            message(FATAL_ERROR "V4K source list refers to a missing file: ${source}")
        endif()
    endif()
endforeach()

add_library(aivision4k SHARED ${V4K_ENGINE_SOURCES})

target_include_directories(aivision4k
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/core
        ${CMAKE_CURRENT_SOURCE_DIR}/ai
        ${CMAKE_CURRENT_SOURCE_DIR}/graphics
        ${CMAKE_CURRENT_SOURCE_DIR}/vulkan
        ${CMAKE_CURRENT_SOURCE_DIR}/sdk
        ${V4K_SHADER_EMBED_DIR}
)

if(V4K_DEBUG_CHECKS)
    target_compile_definitions(aivision4k PRIVATE V4K_DEBUG_CHECKS=1)
else()
    target_compile_definitions(aivision4k PRIVATE V4K_DEBUG_CHECKS=0)
endif()

# Vulkan. The NDK ships the loader stub and the headers, so find_library() is
# enough; when it is missing (rare, non-Android host builds) the backend is
# simply compiled out.
if(V4K_ENABLE_VULKAN)
    find_library(V4K_VULKAN_LIBRARY vulkan)
    if(V4K_VULKAN_LIBRARY)
        target_compile_definitions(aivision4k PRIVATE V4K_ENABLE_VULKAN=1)
        target_link_libraries(aivision4k PRIVATE ${V4K_VULKAN_LIBRARY})
    else()
        message(STATUS "libvulkan not found: building without the Vulkan backend")
    endif()
endif()

# NNAPI. Not every NDK ships the stub; without it the compatibility engine
# reports NNAPI as unavailable, which is exactly what it would do on a device
# without the service.
#
# Note for readers of this file: no translation unit in this tree currently calls
# the NNAPI API, so enabling the option only makes the symbol available — the
# inference paths that exist today are Vulkan compute and the CPU reference
# interpreter. The engine reports that state as-is rather than claiming an NPU
# path it does not run.
if(V4K_ENABLE_NNAPI)
    find_library(V4K_NNAPI_LIBRARY neuralnetworks)
    if(V4K_NNAPI_LIBRARY)
        target_compile_definitions(aivision4k PRIVATE V4K_ENABLE_NNAPI=1)
        target_link_libraries(aivision4k PRIVATE ${V4K_NNAPI_LIBRARY})
    else()
        message(STATUS "libneuralnetworks not found: building without the NNAPI backend")
    endif()
endif()

if(ANDROID)
    # liblog for the logging shim, libandroid for ANativeWindow (the renderer
    # draws into the game's SurfaceView, so it never touches the activity).
    target_link_libraries(aivision4k PRIVATE log android)
else()
    # std::thread in the CPU reference interpreter; part of libc on Android.
    find_package(Threads REQUIRED)
    target_link_libraries(aivision4k PRIVATE Threads::Threads)
endif()

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
    target_compile_options(aivision4k PRIVATE
        -Wall
        -Wextra
        -Wno-unused-parameter
        -Wno-missing-field-initializers
    )
endif()

# Keep the generated shader header in the dependency graph: editing a .spv file
# then rebuilding regenerates the header without a full reconfigure.
if(TARGET v4k_shaders_embedded)
    add_dependencies(aivision4k v4k_shaders_embedded)
endif()

# ---------------------------------------------------------------------------
# Tests
#
# The same core + ai sources the host suite uses, plus tests/*.cpp. Kept out of
# the Gradle build by default; useful on-device (`adb push` the binary) when a
# device-only bug needs the policy code exercised on the real libc.
# ---------------------------------------------------------------------------
set(V4K_TEST_SOURCES
    tests/test_main.cpp
    tests/test_scene.cpp
    tests/test_json.cpp
    tests/test_profile.cpp
    tests/test_thermal.cpp
    tests/test_metrics.cpp
    tests/test_compat.cpp
    tests/test_image.cpp
    tests/test_model.cpp
    tests/test_gpu_plan.cpp
    tests/test_sha256.cpp
)

if(V4K_BUILD_TESTS)
    add_executable(v4k_native_tests
        ${V4K_TEST_SOURCES}
        ${V4K_CORE_SOURCES}
        ${V4K_AI_SOURCES}
        ${V4K_GRAPHICS_SOURCES}
    )
    # Same include roots as the library: several headers include their
    # neighbours by bare name ("v4k_common.h", "v4k_model.h") the way the host
    # script (-I core -I ai) and the NDK build do.
    target_include_directories(v4k_native_tests PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}
        ${CMAKE_CURRENT_SOURCE_DIR}/core
        ${CMAKE_CURRENT_SOURCE_DIR}/ai
        ${CMAKE_CURRENT_SOURCE_DIR}/graphics
        ${V4K_SHADER_EMBED_DIR}
    )
    target_compile_definitions(v4k_native_tests PRIVATE V4K_BUILD_TESTS=1)
    if(ANDROID)
        target_link_libraries(v4k_native_tests PRIVATE log)
    else()
        find_package(Threads REQUIRED)
        target_link_libraries(v4k_native_tests PRIVATE Threads::Threads)
        enable_testing()
        add_test(NAME v4k_native COMMAND v4k_native_tests)
    endif()
    if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
        target_compile_options(v4k_native_tests PRIVATE -Wall -Wextra -Wno-unused-parameter)
    endif()
    message(STATUS "V4K_BUILD_TESTS=ON: the v4k_native_tests binary is part of this build")
endif()

# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------
message(STATUS "AI Vision 4K engine: Vulkan=${V4K_ENABLE_VULKAN} NNAPI=${V4K_ENABLE_NNAPI} "
               "tests=${V4K_BUILD_TESTS} debugChecks=${V4K_DEBUG_CHECKS} "
               "shaders=${V4K_SHADER_EMBED_HEADER}")
