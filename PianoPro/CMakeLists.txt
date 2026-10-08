cmake_minimum_required(VERSION 3.22)
project(PianoPro VERSION 1.0.0 LANGUAGES C CXX)

option(PIANOPRO_FETCH_JUCE "Fetch JUCE 9.0.3 when JUCE_DIR is not configured" ON)
option(PIANOPRO_BUILD_DESKTOP_APP "Build the JUCE desktop executable" ON)
option(PIANOPRO_BUILD_TESTS "Build the headless MIDI and soundfont tests" ON)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if (MSVC)
    # Statically link the MSVC runtime so the installed app does not need a separate VC++ runtime install.
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

if (PIANOPRO_BUILD_DESKTOP_APP)
    find_package(JUCE 9 CONFIG QUIET)
    if (NOT TARGET juce::juce_audio_utils)
        if (NOT PIANOPRO_FETCH_JUCE)
            message(FATAL_ERROR "JUCE 9 was not found. Set JUCE_DIR or enable PIANOPRO_FETCH_JUCE.")
        endif()
        include(FetchContent)
        FetchContent_Declare(
            JUCE
            GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
            GIT_TAG 9.0.3
            GIT_SHALLOW TRUE
            GIT_PROGRESS TRUE
        )
        FetchContent_MakeAvailable(JUCE)
    endif()

    juce_add_gui_app(PianoPro
        PRODUCT_NAME "Piano Pro"
        COMPANY_NAME "Piano Pro"
        BUNDLE_ID "com.pianopro.desktop"
        VERSION "1.0.0"
    )

    target_sources(PianoPro PRIVATE
        Source/Main.cpp
        Source/MainComponent.cpp
        Source/PianoEngine.cpp
        Source/PianoKeyboard.cpp
        Source/MidiManager.cpp
        Source/RecordingManager.cpp
        Source/SettingsManager.cpp
    )

    target_include_directories(PianoPro PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/Source"
        "${CMAKE_CURRENT_SOURCE_DIR}/Source/third_party"
    )

    target_compile_definitions(PianoPro PRIVATE
        JUCE_WEB_BROWSER=0
        JUCE_USE_CURL=0
        JUCE_DISPLAY_SPLASH_SCREEN=0
        JUCE_REPORT_APP_USAGE=0
        JUCE_MODAL_LOOPS_PERMITTED=0
    )

    target_link_libraries(PianoPro PRIVATE
        juce::juce_audio_utils
        juce::juce_audio_devices
        juce::juce_data_structures
        juce::juce_gui_extra
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags
    )

    set_target_properties(PianoPro PROPERTIES
        OUTPUT_NAME "PianoPro"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
    )

    if (MSVC)
        target_compile_options(PianoPro PRIVATE /W4 /permissive- /EHsc /utf-8)
        target_compile_definitions(PianoPro PRIVATE _CRT_SECURE_NO_WARNINGS NOMINMAX WIN32_LEAN_AND_MEAN)
    else()
        target_compile_options(PianoPro PRIVATE -Wall -Wextra -Wpedantic)
    endif()

    # Keep all runtime files beside PianoPro.exe. The installed application never fetches assets.
    add_custom_command(TARGET PianoPro POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_directory
                "${CMAKE_CURRENT_SOURCE_DIR}/assets/sounds"
                "$<TARGET_FILE_DIR:PianoPro>/assets/sounds"
        COMMENT "Copying local SoundFonts beside Piano Pro"
    )

    install(TARGETS PianoPro
        RUNTIME DESTINATION .
        BUNDLE DESTINATION .
    )
    install(DIRECTORY assets/sounds/ DESTINATION assets/sounds)
    install(FILES LICENSE README.md THIRD-PARTY-NOTICES.md DESTINATION .)
    install(FILES Source/third_party/TSF-LICENSE.txt DESTINATION licenses)
endif()

if (PIANOPRO_BUILD_TESTS)
    include(CTest)

    add_executable(PianoProMidiTests
        tests/RecordingManagerTests.cpp
        Source/RecordingManager.cpp
    )
    target_include_directories(PianoProMidiTests PRIVATE Source)
    target_compile_features(PianoProMidiTests PRIVATE cxx_std_17)
    add_test(NAME PianoPro.MidiRoundTrip COMMAND PianoProMidiTests)

    add_executable(PianoProSoundFontSmoke
        tests/SoundFontSmokeTest.cpp
    )
    target_include_directories(PianoProSoundFontSmoke PRIVATE Source/third_party)
    target_compile_features(PianoProSoundFontSmoke PRIVATE cxx_std_17)
    add_test(NAME PianoPro.SoundFontPlayback
        COMMAND PianoProSoundFontSmoke
                "${CMAKE_CURRENT_SOURCE_DIR}/assets/sounds/GeneralUser-GS.sf2"
                "${CMAKE_CURRENT_SOURCE_DIR}/assets/sounds/UprightPianoKW-small-20190703.sf2"
    )

    add_executable(PianoProEngineTests
        tests/PianoEngineTests.cpp
        Source/PianoEngine.cpp
    )
    target_include_directories(PianoProEngineTests PRIVATE Source Source/third_party)
    target_compile_features(PianoProEngineTests PRIVATE cxx_std_17)
    add_test(NAME PianoPro.AudioEngine
        COMMAND PianoProEngineTests
                "${CMAKE_CURRENT_SOURCE_DIR}/assets/sounds/GeneralUser-GS.sf2"
                "${CMAKE_CURRENT_SOURCE_DIR}/assets/sounds/UprightPianoKW-small-20190703.sf2"
    )
endif()

set(CPACK_PACKAGE_NAME "Piano Pro")
set(CPACK_PACKAGE_VENDOR "Piano Pro")
set(CPACK_PACKAGE_VERSION "${PROJECT_VERSION}")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "Offline desktop piano with local sampled instruments")
set(CPACK_PACKAGE_INSTALL_DIRECTORY "Piano Pro")
include(CPack)
