let sourcePixels = null;
let softenedPixels = null;
let sourceWidth = 0;
let sourceHeight = 0;

self.postMessage({ type: 'ready' });

self.onmessage = (event) => {
  const message = event.data || {};

  if (message.type === 'clear') {
    sourcePixels = null;
    softenedPixels = null;
    sourceWidth = 0;
    sourceHeight = 0;
    return;
  }

  if (message.type === 'load') {
    sourceWidth = message.width;
    sourceHeight = message.height;
    sourcePixels = new Uint8ClampedArray(message.sourceBuffer);
    softenedPixels = new Uint8ClampedArray(message.softenedBuffer);
    self.postMessage({ type: 'loaded', token: message.token });
    return;
  }

  if (message.type !== 'render' || !sourcePixels || !softenedPixels) return;

  const length = sourcePixels.length;
  const output = new Uint8ClampedArray(length);
  const sharpness = (message.settings.sharpness / 100) * 1.65;
  const denoise = (message.settings.noise / 100) * 0.46;
  const saturation = 0.80 + (message.settings.color / 100) * 0.48;
  const contrast = 1.015 + (message.settings.sharpness / 100) * 0.105;
  const brightness = 1.012;

  for (let index = 0; index < length; index += 4) {
    const red = sourcePixels[index];
    const green = sourcePixels[index + 1];
    const blue = sourcePixels[index + 2];
    const blurRed = softenedPixels[index];
    const blurGreen = softenedPixels[index + 1];
    const blurBlue = softenedPixels[index + 2];

    let r = red + (blurRed - red) * denoise + (red - blurRed) * sharpness;
    let g = green + (blurGreen - green) * denoise + (green - blurGreen) * sharpness;
    let b = blue + (blurBlue - blue) * denoise + (blue - blurBlue) * sharpness;

    const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
    r = (luminance + (r - luminance) * saturation - 127.5) * contrast + 127.5;
    g = (luminance + (g - luminance) * saturation - 127.5) * contrast + 127.5;
    b = (luminance + (b - luminance) * saturation - 127.5) * contrast + 127.5;

    output[index] = r * brightness;
    output[index + 1] = g * brightness;
    output[index + 2] = b * brightness;
    output[index + 3] = sourcePixels[index + 3];
  }

  self.postMessage({
    type: 'rendered',
    id: message.id,
    width: sourceWidth,
    height: sourceHeight,
    outputBuffer: output.buffer,
  }, [output.buffer]);
};
