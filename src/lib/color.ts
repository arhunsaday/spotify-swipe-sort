/* Dominant-color extraction for the ambient tint behind the focus view.
 * Hand-rolled (a downscaled canvas + saturated-bucket vote) rather than a
 * library, so we control crossOrigin and degrade gracefully if the image
 * taints the canvas. Spotify's i.scdn.co covers send CORS headers. */

const cache = new Map<string, string>();

export async function dominantColor(imageUrl: string): Promise<string | null> {
  if (!imageUrl) return null;
  const hit = cache.get(imageUrl);
  if (hit) return hit;

  const rgb = await extract(imageUrl).catch(() => null);
  if (!rgb) return null;
  const css = `${rgb[0]}, ${rgb[1]}, ${rgb[2]}`;
  cache.set(imageUrl, css);
  return css;
}

function extract(url: string): Promise<[number, number, number]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const size = 24;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return reject(new Error("no ctx"));
      ctx.drawImage(img, 0, 0, size, size);
      let data: Uint8ClampedArray;
      try {
        data = ctx.getImageData(0, 0, size, size).data;
      } catch (e) {
        return reject(e); // tainted canvas
      }
      // pick the most vivid pixel bucket, weighting saturation over frequency
      let best: [number, number, number] = [80, 80, 90];
      let bestScore = -1;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i],
          g = data[i + 1],
          b = data[i + 2],
          a = data[i + 3];
        if (a < 200) continue;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const sat = max === 0 ? 0 : (max - min) / max;
        const lum = (max + min) / 2;
        // favour saturated mid-tones; avoid near-black/near-white
        const score = sat * 1.6 + (1 - Math.abs(lum - 140) / 140);
        if (score > bestScore) {
          bestScore = score;
          best = [r, g, b];
        }
      }
      resolve(best);
    };
    img.onerror = reject;
    img.src = url;
  });
}
