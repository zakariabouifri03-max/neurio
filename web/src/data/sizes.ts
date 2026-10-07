import type { DocKind, SizePreset } from '@/engine/types';

/** Every canvas size the studio can start from, grouped for the picker. */
export const SIZE_PRESETS: SizePreset[] = [
  // Social
  { id: 'ig-post', name: 'Instagram post', group: 'Social', width: 1080, height: 1080 },
  { id: 'ig-portrait', name: 'Instagram portrait', group: 'Social', width: 1080, height: 1350 },
  { id: 'ig-story', name: 'Instagram story', group: 'Social', width: 1080, height: 1920 },
  { id: 'ig-reel', name: 'Instagram reel cover', group: 'Social', width: 1080, height: 1920 },
  { id: 'tiktok', name: 'TikTok', group: 'Social', width: 1080, height: 1920 },
  { id: 'fb-post', name: 'Facebook post', group: 'Social', width: 1200, height: 630 },
  { id: 'fb-cover', name: 'Facebook cover', group: 'Social', width: 1640, height: 624 },
  { id: 'fb-story', name: 'Facebook story', group: 'Social', width: 1080, height: 1920 },
  { id: 'x-post', name: 'X post', group: 'Social', width: 1600, height: 900 },
  { id: 'x-header', name: 'X header', group: 'Social', width: 1500, height: 500 },
  { id: 'linkedin-post', name: 'LinkedIn post', group: 'Social', width: 1200, height: 627 },
  { id: 'linkedin-banner', name: 'LinkedIn banner', group: 'Social', width: 1584, height: 396 },
  { id: 'pinterest', name: 'Pinterest pin', group: 'Social', width: 1000, height: 1500 },
  { id: 'threads', name: 'Threads post', group: 'Social', width: 1080, height: 1350 },

  // Video
  { id: 'yt-thumb', name: 'YouTube thumbnail', group: 'Video', width: 1280, height: 720 },
  { id: 'yt-banner', name: 'YouTube banner', group: 'Video', width: 2560, height: 1440 },
  { id: 'yt-shorts', name: 'YouTube shorts', group: 'Video', width: 1080, height: 1920 },
  { id: 'twitch-banner', name: 'Twitch banner', group: 'Video', width: 1200, height: 480 },
  { id: 'video-16-9', name: 'Video 16:9 (1080p)', group: 'Video', width: 1920, height: 1080 },
  { id: 'video-4k', name: 'Video 16:9 (4K)', group: 'Video', width: 3840, height: 2160 },
  { id: 'video-9-16', name: 'Video 9:16 (1080p)', group: 'Video', width: 1080, height: 1920 },
  { id: 'video-1-1', name: 'Video 1:1', group: 'Video', width: 1080, height: 1080 },
  { id: 'video-4-5', name: 'Video 4:5', group: 'Video', width: 1080, height: 1350 },

  // Presentation
  { id: 'presentation-16-9', name: 'Presentation 16:9', group: 'Presentation', width: 1920, height: 1080, kind: 'presentation' },
  { id: 'presentation-4-3', name: 'Presentation 4:3', group: 'Presentation', width: 1600, height: 1200, kind: 'presentation' },
  { id: 'presentation-a4', name: 'Presentation A4', group: 'Presentation', width: 1123, height: 794, kind: 'presentation' },

  // Document (A4 at 96dpi ≈ 794×1123, US Letter ≈ 816×1056)
  { id: 'a4', name: 'A4 document', group: 'Document', width: 794, height: 1123, kind: 'document' },
  { id: 'us-letter', name: 'US Letter', group: 'Document', width: 816, height: 1056, kind: 'document' },
  { id: 'a5', name: 'A5 document', group: 'Document', width: 559, height: 794, kind: 'document' },
  { id: 'legal', name: 'Legal', group: 'Document', width: 816, height: 1344, kind: 'document' },

  // Print
  { id: 'poster-a3', name: 'Poster A3', group: 'Print', width: 1123, height: 1587 },
  { id: 'poster-a2', name: 'Poster A2', group: 'Print', width: 1587, height: 2245 },
  { id: 'poster-a1', name: 'Poster A1', group: 'Print', width: 2245, height: 3179 },
  { id: 'business-card', name: 'Business card', group: 'Print', width: 1050, height: 600 },
  { id: 'business-card-square', name: 'Square business card', group: 'Print', width: 750, height: 750 },
  { id: 'flyer-a5', name: 'Flyer A5', group: 'Print', width: 559, height: 794 },
  { id: 'flyer-letter', name: 'Flyer letter', group: 'Print', width: 816, height: 1056 },
  { id: 'brochure', name: 'Tri-fold brochure', group: 'Print', width: 1050, height: 800 },
  { id: 'menu', name: 'Menu', group: 'Print', width: 794, height: 1123 },
  { id: 'certificate', name: 'Certificate landscape', group: 'Print', width: 1600, height: 1131 },
  { id: 'certificate-portrait', name: 'Certificate portrait', group: 'Print', width: 1131, height: 1600 },
  { id: 'invitation', name: 'Invitation 5×7', group: 'Print', width: 1500, height: 2100 },
  { id: 'ticket', name: 'Event ticket', group: 'Print', width: 1800, height: 600 },
  { id: 'tshirt', name: 'T-shirt print', group: 'Print', width: 2000, height: 2400 },
  { id: 'sticker', name: 'Sticker 4×4', group: 'Print', width: 1200, height: 1200 },
  { id: 'book-cover', name: 'Book cover', group: 'Print', width: 1600, height: 2560 },
  { id: 'album-cover', name: 'Album cover', group: 'Print', width: 1400, height: 1400 },
  { id: 'postcard', name: 'Postcard 6×4', group: 'Print', width: 1800, height: 1200 },
  { id: 'label', name: 'Product label', group: 'Print', width: 1200, height: 800 },

  // Web & screens
  { id: 'wallpaper-desktop', name: 'Desktop wallpaper', group: 'Web', width: 1920, height: 1080 },
  { id: 'wallpaper-mobile', name: 'Mobile wallpaper', group: 'Web', width: 1080, height: 1920 },
  { id: 'website-hero', name: 'Website hero', group: 'Web', width: 1920, height: 900 },
  { id: 'blog-banner', name: 'Blog banner', group: 'Web', width: 1600, height: 840 },
  { id: 'email-header', name: 'Email header', group: 'Web', width: 600, height: 200 },
  { id: 'app-store', name: 'App store screenshot', group: 'Web', width: 1242, height: 2208 },
  { id: 'og-image', name: 'Open Graph image', group: 'Web', width: 1200, height: 630 },
  { id: 'infographic', name: 'Infographic tall', group: 'Web', width: 1000, height: 3000 },

  // Brand
  { id: 'logo', name: 'Logo', group: 'Brand', width: 1000, height: 1000 },
  { id: 'logo-wide', name: 'Logo wide', group: 'Brand', width: 1600, height: 600 },
  { id: 'favicon', name: 'Favicon', group: 'Brand', width: 512, height: 512 },
  { id: 'brand-board', name: 'Brand board', group: 'Brand', width: 1600, height: 1000 },

  // Ads
  { id: 'ad-square', name: 'Display ad square', group: 'Ads', width: 1000, height: 1000 },
  { id: 'ad-leaderboard', name: 'Leaderboard ad', group: 'Ads', width: 1456, height: 180 },
  { id: 'ad-mpu', name: 'Medium rectangle', group: 'Ads', width: 600, height: 500 },
  { id: 'ad-billboard', name: 'Billboard', group: 'Ads', width: 3000, height: 1500 },
];

export const SIZE_GROUPS = ['Social', 'Video', 'Presentation', 'Document', 'Print', 'Web', 'Brand', 'Ads'];

export function sizePreset(id: string): SizePreset | undefined {
  return SIZE_PRESETS.find((s) => s.id === id);
}

/** The presets offered by the one-click resize tool. */
export const RESIZE_TARGETS: { id: string; label: string; width: number; height: number; icon?: string }[] = [
  { id: 'ig-post', label: 'Instagram post', width: 1080, height: 1080 },
  { id: 'ig-story', label: 'Instagram story', width: 1080, height: 1920 },
  { id: 'tiktok', label: 'TikTok', width: 1080, height: 1920 },
  { id: 'yt-thumb', label: 'YouTube thumbnail', width: 1280, height: 720 },
  { id: 'yt-banner', label: 'YouTube banner', width: 2560, height: 1440 },
  { id: 'fb-post', label: 'Facebook post', width: 1200, height: 630 },
  { id: 'linkedin-post', label: 'LinkedIn post', width: 1200, height: 627 },
  { id: 'x-post', label: 'X post', width: 1600, height: 900 },
  { id: 'pinterest', label: 'Pinterest pin', width: 1000, height: 1500 },
  { id: 'presentation-16-9', label: 'Presentation 16:9', width: 1920, height: 1080 },
  { id: 'a4', label: 'A4 document', width: 794, height: 1123 },
  { id: 'poster-a3', label: 'Poster A3', width: 1123, height: 1587 },
];

export function kindForGroup(group: string): DocKind {
  if (group === 'Presentation') return 'presentation';
  if (group === 'Document') return 'document';
  if (group === 'Video') return 'video';
  return 'design';
}
