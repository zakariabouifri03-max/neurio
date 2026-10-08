#include "MainComponent.h"

namespace piano
{

class MainWindow final : public juce::DocumentWindow
{
public:
    MainWindow()
        : juce::DocumentWindow ("Piano Pro",
                                juce::Colour (0xff0a1020),
                                juce::DocumentWindow::allButtons)
    {
        setUsingNativeTitleBar (true);
        setResizable (true, true);
        setResizeLimits (1120, 640, 1920, 1280);
        setContentOwned (new MainComponent(), true);
        centreWithSize (1240, 760);
        setVisible (true);
    }

    void closeButtonPressed() override
    {
        if (auto* app = juce::JUCEApplication::getInstance())
            app->systemRequestedQuit();
    }
};

class PianoProApplication final : public juce::JUCEApplication
{
public:
    const juce::String getApplicationName() override { return "Piano Pro"; }
    const juce::String getApplicationVersion() override { return "1.0.0"; }
    bool moreThanOneInstanceAllowed() override { return true; }

    void initialise (const juce::String&) override
    {
        mainWindow = std::make_unique<MainWindow>();
    }

    void shutdown() override
    {
        mainWindow.reset();
    }

    void systemRequestedQuit() override
    {
        quit();
    }

private:
    std::unique_ptr<MainWindow> mainWindow;
};

} // namespace piano

START_JUCE_APPLICATION (piano::PianoProApplication)
