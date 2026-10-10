class AppError(Exception):
    """An error whose message is safe and meaningful to show to the user."""

    def __init__(self, message: str, *, details: str = ""):
        super().__init__(message)
        self.user_message = message
        # Technical details go to the log only, never to the UI.
        self.details = details


class FFmpegNotFound(AppError):
    pass


class OperationCancelled(AppError):
    pass
