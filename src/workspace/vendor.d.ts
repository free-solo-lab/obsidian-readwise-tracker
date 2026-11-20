declare module "rwt-pdf-worker" {
  const source: string;
  export default source;
}
declare module "rwt-pdf-assets" {
  const assets: {
    cmaps: Record<string, string>;
    fonts: Record<string, string>;
  };
  export default assets;
}
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export { getDocument, PDFWorker } from "pdfjs-dist";
}
