"""Interface strings for English, French, Spanish and Arabic (RTL)."""
from __future__ import annotations

LANGUAGES = {"en": "English", "fr": "Français", "es": "Español", "ar": "العربية"}
RTL_LANGUAGES = {"ar"}

_STRINGS: dict[str, dict[str, str]] = {
    "en": {
        "dashboard": "Dashboard", "video": "Video Studio", "photo": "Photo & Design",
        "converter": "Media Converter", "audio": "Audio Studio", "assistant": "AI Assistant",
        "ai_studio": "AI Studio", "settings": "Settings", "file": "File", "edit": "Edit",
        "view": "View", "help": "Help", "new_project": "New project", "open_project": "Open project",
        "save": "Save", "undo": "Undo", "redo": "Redo", "export": "Export", "import": "Import",
        "recent": "Recent projects", "search_tools": "Search tools…", "ready": "Ready",
        "recovered": "Unsaved work was found. Recover it?", "exporting": "Exporting…",
        "done": "Done", "cancel": "Cancel", "error": "Error", "drop_hint": "Drop media files here",
        "playhead": "Playhead", "split": "Split at playhead", "delete": "Delete clip",
        "ffmpeg_missing": "FFmpeg is missing. See Help > About.", "language": "Language",
        "theme": "Theme", "dark": "Dark", "light": "Light",
    },
    "fr": {
        "dashboard": "Tableau de bord", "video": "Studio Vidéo", "photo": "Photo & Design",
        "converter": "Convertisseur", "audio": "Studio Audio", "assistant": "Assistant IA",
        "ai_studio": "Studio IA", "settings": "Paramètres", "file": "Fichier", "edit": "Édition",
        "view": "Affichage", "help": "Aide", "new_project": "Nouveau projet", "open_project": "Ouvrir un projet",
        "save": "Enregistrer", "undo": "Annuler", "redo": "Rétablir", "export": "Exporter", "import": "Importer",
        "recent": "Projets récents", "search_tools": "Rechercher des outils…", "ready": "Prêt",
        "recovered": "Un travail non enregistré a été trouvé. Le récupérer ?", "exporting": "Export en cours…",
        "done": "Terminé", "cancel": "Annuler", "error": "Erreur", "drop_hint": "Déposez les fichiers ici",
        "playhead": "Tête de lecture", "split": "Couper à la tête de lecture", "delete": "Supprimer le clip",
        "ffmpeg_missing": "FFmpeg est introuvable. Voir Aide > À propos.", "language": "Langue",
        "theme": "Thème", "dark": "Sombre", "light": "Clair",
    },
    "es": {
        "dashboard": "Panel", "video": "Estudio de Video", "photo": "Foto y Diseño",
        "converter": "Convertidor", "audio": "Estudio de Audio", "assistant": "Asistente IA",
        "ai_studio": "Estudio IA", "settings": "Ajustes", "file": "Archivo", "edit": "Editar",
        "view": "Ver", "help": "Ayuda", "new_project": "Nuevo proyecto", "open_project": "Abrir proyecto",
        "save": "Guardar", "undo": "Deshacer", "redo": "Rehacer", "export": "Exportar", "import": "Importar",
        "recent": "Proyectos recientes", "search_tools": "Buscar herramientas…", "ready": "Listo",
        "recovered": "Se encontró trabajo sin guardar. ¿Recuperarlo?", "exporting": "Exportando…",
        "done": "Hecho", "cancel": "Cancelar", "error": "Error", "drop_hint": "Suelta los archivos aquí",
        "playhead": "Cabezal", "split": "Dividir en el cabezal", "delete": "Eliminar clip",
        "ffmpeg_missing": "Falta FFmpeg. Ver Ayuda > Acerca de.", "language": "Idioma",
        "theme": "Tema", "dark": "Oscuro", "light": "Claro",
    },
    "ar": {
        "dashboard": "لوحة المشاريع", "video": "استوديو الفيديو", "photo": "الصور والتصميم",
        "converter": "محول الوسائط", "audio": "استوديو الصوت", "assistant": "المساعد الذكي",
        "ai_studio": "استوديو الذكاء الاصطناعي", "settings": "الإعدادات", "file": "ملف", "edit": "تحرير",
        "view": "عرض", "help": "مساعدة", "new_project": "مشروع جديد", "open_project": "فتح مشروع",
        "save": "حفظ", "undo": "تراجع", "redo": "إعادة", "export": "تصدير", "import": "استيراد",
        "recent": "المشاريع الأخيرة", "search_tools": "ابحث عن الأدوات…", "ready": "جاهز",
        "recovered": "تم العثور على عمل غير محفوظ. هل تريد استعادته؟", "exporting": "جارٍ التصدير…",
        "done": "تم", "cancel": "إلغاء", "error": "خطأ", "drop_hint": "أفلت الملفات هنا",
        "playhead": "رأس التشغيل", "split": "قص عند رأس التشغيل", "delete": "حذف المقطع",
        "ffmpeg_missing": "برنامج FFmpeg غير موجود. انظر مساعدة > حول.", "language": "اللغة",
        "theme": "المظهر", "dark": "داكن", "light": "فاتح",
    },
}

_current = "en"


def set_language(lang: str) -> None:
    global _current
    _current = lang if lang in _STRINGS else "en"


def current_language() -> str:
    return _current


def tr(key: str) -> str:
    return _STRINGS.get(_current, _STRINGS["en"]).get(key) or _STRINGS["en"].get(key, key)


def is_rtl(lang: str | None = None) -> bool:
    return (lang or _current) in RTL_LANGUAGES
