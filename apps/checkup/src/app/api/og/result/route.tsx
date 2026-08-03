import { resultShareOgImage } from "@/lib/seo/result-share-image";

/** OG dinâmica do /resultado — só escala na query (sem escore/PII). */
export async function GET(request: Request) {
  const scale = new URL(request.url).searchParams.get("scale");
  return resultShareOgImage(scale);
}
