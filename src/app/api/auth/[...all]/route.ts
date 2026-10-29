import { getAuth } from '@/modules/auth/server';
import { isAuthConfigured } from '@/modules/auth/config';
export const runtime = 'nodejs';
async function handler(request: Request) {
  if (!isAuthConfigured())
    return Response.json({ error: 'El acceso todavía no está configurado.' }, { status: 503 });
  return getAuth().handler(request);
}
export { handler as GET, handler as POST };
