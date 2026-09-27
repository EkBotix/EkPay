import { readIntent } from "@/lib/api/payment-intents";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return readIntent(request, (await params).id);
}
