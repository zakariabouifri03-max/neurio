"""Internationalisation: English, Arabic, French and Spanish.

The translator works without Qt so core modules and tests can use it too.
Arabic is right-to-left; the UI layer asks :func:`is_rtl` to flip layouts.
Missing translations fall back to English, and the English string is always
returned for unknown keys, so a missing entry never produces an empty UI.
"""

from __future__ import annotations

LANGUAGES = {
    "en": "English",
    "ar": "العربية",
    "fr": "Français",
    "es": "Español",
}

_RTL = {"ar"}

# key -> {lang: text}.  English is the source of truth.
_STRINGS: dict[str, dict[str, str]] = {
    "app.name": {"en": "ADZAK CREATIVE STUDIO", "ar": "استوديو أدزاك الإبداعي", "fr": "ADZAK CREATIVE STUDIO", "es": "ADZAK CREATIVE STUDIO"},
    "menu.file": {"en": "&File", "ar": "ملف", "fr": "&Fichier", "es": "&Archivo"},
    "menu.edit": {"en": "&Edit", "ar": "تحرير", "fr": "&Édition", "es": "&Editar"},
    "menu.view": {"en": "&View", "ar": "عرض", "fr": "&Affichage", "es": "&Vista"},
    "menu.help": {"en": "&Help", "ar": "مساعدة", "fr": "&Aide", "es": "A&yuda"},
    "action.new_project": {"en": "New Project…", "ar": "مشروع جديد…", "fr": "Nouveau projet…", "es": "Nuevo proyecto…"},
    "action.open_project": {"en": "Open Project…", "ar": "فتح مشروع…", "fr": "Ouvrir un projet…", "es": "Abrir proyecto…"},
    "action.save_project": {"en": "Save Project", "ar": "حفظ المشروع", "fr": "Enregistrer le projet", "es": "Guardar proyecto"},
    "action.undo": {"en": "Undo", "ar": "تراجع", "fr": "Annuler", "es": "Deshacer"},
    "action.redo": {"en": "Redo", "ar": "إعادة", "fr": "Rétablir", "es": "Rehacer"},
    "action.export": {"en": "Export…", "ar": "تصدير…", "fr": "Exporter…", "es": "Exportar…"},
    "action.import_media": {"en": "Import Media…", "ar": "استيراد وسائط…", "fr": "Importer des médias…", "es": "Importar medios…"},
    "action.settings": {"en": "Settings…", "ar": "الإعدادات…", "fr": "Paramètres…", "es": "Ajustes…"},
    "action.about": {"en": "About…", "ar": "حول…", "fr": "À propos…", "es": "Acerca de…"},
    "action.quit": {"en": "Quit", "ar": "خروج", "fr": "Quitter", "es": "Salir"},
    "tool.dashboard": {"en": "Dashboard", "ar": "لوحة المشاريع", "fr": "Tableau de bord", "es": "Panel"},
    "tool.video_editor": {"en": "Video Editor", "ar": "محرر الفيديو", "fr": "Montage vidéo", "es": "Editor de vídeo"},
    "tool.photo_editor": {"en": "Photo Editor", "ar": "محرر الصور", "fr": "Éditeur photo", "es": "Editor de fotos"},
    "tool.design": {"en": "Graphic Design", "ar": "التصميم الجرافيكي", "fr": "Design graphique", "es": "Diseño gráfico"},
    "tool.ai_image": {"en": "AI Image Studio", "ar": "استوديو صور الذكاء الاصطناعي", "fr": "Studio image IA", "es": "Estudio de imágenes IA"},
    "tool.ai_video": {"en": "AI Video Studio", "ar": "استوديو فيديو الذكاء الاصطناعي", "fr": "Studio vidéo IA", "es": "Estudio de vídeo IA"},
    "tool.audio": {"en": "Audio Studio", "ar": "استوديو الصوت", "fr": "Studio audio", "es": "Estudio de audio"},
    "tool.animation": {"en": "Animation", "ar": "الرسوم المتحركة", "fr": "Animation", "es": "Animación"},
    "tool.converter": {"en": "Media Converter", "ar": "محول الوسائط", "fr": "Convertisseur", "es": "Conversor"},
    "tool.assistant": {"en": "AI Assistant", "ar": "المساعد الذكي", "fr": "Assistant IA", "es": "Asistente IA"},
    "search.tools": {"en": "Search tools…", "ar": "ابحث في الأدوات…", "fr": "Rechercher un outil…", "es": "Buscar herramientas…"},
    "dashboard.recent": {"en": "Recent Projects", "ar": "المشاريع الأخيرة", "fr": "Projets récents", "es": "Proyectos recientes"},
    "dashboard.empty": {"en": "No projects yet. Create your first project to get started.", "ar": "لا توجد مشاريع بعد. أنشئ مشروعك الأول للبدء.", "fr": "Aucun projet. Créez votre premier projet pour commencer.", "es": "Aún no hay proyectos. Crea el primero para empezar."},
    "dashboard.welcome": {"en": "Welcome to ADZAK CREATIVE STUDIO", "ar": "مرحبًا بك في استوديو أدزاك الإبداعي", "fr": "Bienvenue dans ADZAK CREATIVE STUDIO", "es": "Bienvenido a ADZAK CREATIVE STUDIO"},
    "project.name": {"en": "Project name", "ar": "اسم المشروع", "fr": "Nom du projet", "es": "Nombre del proyecto"},
    "project.create": {"en": "Create", "ar": "إنشاء", "fr": "Créer", "es": "Crear"},
    "project.delete": {"en": "Delete", "ar": "حذف", "fr": "Supprimer", "es": "Eliminar"},
    "common.ok": {"en": "OK", "ar": "حسنًا", "fr": "OK", "es": "Aceptar"},
    "common.cancel": {"en": "Cancel", "ar": "إلغاء", "fr": "Annuler", "es": "Cancelar"},
    "common.close": {"en": "Close", "ar": "إغلاق", "fr": "Fermer", "es": "Cerrar"},
    "common.browse": {"en": "Browse…", "ar": "استعراض…", "fr": "Parcourir…", "es": "Examinar…"},
    "common.apply": {"en": "Apply", "ar": "تطبيق", "fr": "Appliquer", "es": "Aplicar"},
    "common.yes": {"en": "Yes", "ar": "نعم", "fr": "Oui", "es": "Sí"},
    "common.no": {"en": "No", "ar": "لا", "fr": "Non", "es": "No"},
    "status.ready": {"en": "Ready", "ar": "جاهز", "fr": "Prêt", "es": "Listo"},
    "status.working": {"en": "Working…", "ar": "جارٍ العمل…", "fr": "Traitement…", "es": "Trabajando…"},
    "export.title": {"en": "Export", "ar": "تصدير", "fr": "Exportation", "es": "Exportar"},
    "export.preset": {"en": "Preset", "ar": "الإعداد المسبق", "fr": "Préréglage", "es": "Ajuste predefinido"},
    "export.start": {"en": "Start Export", "ar": "بدء التصدير", "fr": "Lancer l'export", "es": "Iniciar exportación"},
    "export.success": {"en": "Export finished successfully.", "ar": "اكتمل التصدير بنجاح.", "fr": "Export terminé avec succès.", "es": "Exportación completada."},
    "export.failed": {"en": "Export failed.", "ar": "فشل التصدير.", "fr": "Échec de l'export.", "es": "Falló la exportación."},
    "timeline.split": {"en": "Split at playhead", "ar": "قص عند المؤشر", "fr": "Diviser à la tête de lecture", "es": "Dividir en el cursor"},
    "timeline.delete": {"en": "Delete clip", "ar": "حذف المقطع", "fr": "Supprimer le clip", "es": "Eliminar clip"},
    "timeline.add_track": {"en": "Add track", "ar": "إضافة مسار", "fr": "Ajouter une piste", "es": "Añadir pista"},
    "error.no_ffmpeg": {"en": "FFmpeg was not found. Media processing is disabled until it is installed or configured in Settings.", "ar": "لم يتم العثور على FFmpeg. تمت معالجة الوسائط معطلة حتى يتم تثبيته أو ضبطه في الإعدادات.", "fr": "FFmpeg introuvable. Le traitement des médias est désactivé.", "es": "No se encontró FFmpeg. El procesamiento está desactivado."},
    "error.file_not_found": {"en": "File not found: {path}", "ar": "الملف غير موجود: {path}", "fr": "Fichier introuvable : {path}", "es": "Archivo no encontrado: {path}"},
    "ai.no_provider": {"en": "No AI provider configured. Local tools still work; API features need a provider and key in Settings.", "ar": "لم يتم ضبط مزود ذكاء اصطناعي. الأدوات المحلية تعمل، وتتطلب ميزات الواجهة البرمجية مزودًا ومفتاحًا في الإعدادات.", "fr": "Aucun fournisseur IA configuré. Les outils locaux fonctionnent toujours.", "es": "Ningún proveedor de IA configurado. Las herramientas locales siguen funcionando."},
    "help.onboarding": {"en": "Quick start: create a project, import media, then use the sidebar to switch studios.", "ar": "البداية السريعة: أنشئ مشروعًا واستورد الوسائط ثم استخدم الشريط الجانبي للتنقل بين الاستوديوهات.", "fr": "Démarrage : créez un projet, importez des médias, puis changez de studio via la barre latérale.", "es": "Inicio rápido: crea un proyecto, importa medios y cambia de estudio con la barra lateral."},
    "settings.theme": {"en": "Theme", "ar": "السمة", "fr": "Thème", "es": "Tema"},
    "settings.language": {"en": "Language", "ar": "اللغة", "fr": "Langue", "es": "Idioma"},
    "settings.low_memory": {"en": "Low-memory mode", "ar": "وضع الذاكرة المنخفضة", "fr": "Mode mémoire réduite", "es": "Modo memoria reducida"},
    "settings.preview_quality": {"en": "Preview quality", "ar": "جودة المعاينة", "fr": "Qualité de l'aperçu", "es": "Calidad de vista previa"},
    "settings.threads": {"en": "Render threads (0 = auto)", "ar": "خيوط التصيير (0 = تلقائي)", "fr": "Threads de rendu (0 = auto)", "es": "Hilos de renderizado (0 = auto)"},
    "settings.cache_limit": {"en": "Cache limit (MB)", "ar": "حد ذاكرة التخزين المؤقت (ميغابايت)", "fr": "Limite du cache (Mo)", "es": "Límite de caché (MB)"},
    "settings.ffmpeg_path": {"en": "FFmpeg path", "ar": "مسار FFmpeg", "fr": "Chemin de FFmpeg", "es": "Ruta de FFmpeg"},
    "settings.cleanup_cache": {"en": "Clear cache now", "ar": "مسح ذاكرة التخزين المؤقت الآن", "fr": "Vider le cache", "es": "Vaciar caché ahora"},
    "common.error": {"en": "Error", "ar": "خطأ", "fr": "Erreur", "es": "Error"},
    "common.info": {"en": "Info", "ar": "معلومات", "fr": "Info", "es": "Información"},
    "common.warning": {"en": "Warning", "ar": "تحذير", "fr": "Avertissement", "es": "Advertencia"},
}


class Translator:
    def __init__(self, language: str = "en"):
        self._lang = language if language in LANGUAGES else "en"

    @property
    def language(self) -> str:
        return self._lang

    def set_language(self, language: str) -> None:
        self._lang = language if language in LANGUAGES else "en"

    def is_rtl(self) -> bool:
        return self._lang in _RTL

    def tr(self, key: str, **fmt) -> str:
        entry = _STRINGS.get(key)
        if entry is None:
            text = key
        else:
            text = entry.get(self._lang) or entry.get("en") or key
        if fmt:
            try:
                text = text.format(**fmt)
            except (KeyError, IndexError, ValueError):
                pass
        return text

    __call__ = tr


def known_keys() -> list[str]:
    return sorted(_STRINGS)


def languages_missing_translations() -> dict[str, list[str]]:
    """Diagnostic helper: which keys lack a translation per language."""
    missing: dict[str, list[str]] = {lang: [] for lang in LANGUAGES if lang != "en"}
    for key, entry in _STRINGS.items():
        for lang in missing:
            if not entry.get(lang):
                missing[lang].append(key)
    return missing
