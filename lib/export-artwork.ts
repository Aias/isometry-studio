export async function exportArtwork(svg: string, filename: string, format: "svg" | "png") {
  let blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  if (format === "png") {
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("The artwork could not be rendered for PNG export.")); image.src = url; });
      const canvas = document.createElement("canvas");
      const scale = 3000 / Math.max(image.naturalWidth, image.naturalHeight);
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser could not prepare PNG export.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error("PNG export failed.")), "image/png"));
    } finally { URL.revokeObjectURL(url); }
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${filename.replace(/[^a-zA-Z0-9_-]/g, "-")}.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}
