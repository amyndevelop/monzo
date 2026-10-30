import { apiResponse } from '@/modules/tenants/http';
import { getAttachment, attachmentFailure } from '@/modules/whatsapp/attachments';
import { attachmentResponse } from '@/modules/whatsapp/core/media-response';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantId: string; messageId: string }> },
) {
  try {
    const { tenantId, messageId } = await params;
    const file = await getAttachment(tenantId, messageId);
    return attachmentResponse(file, request);
  } catch (error) {
    return apiResponse(async () => attachmentFailure(error));
  }
}
