import { NextRequest, NextResponse } from 'next/server'
import { handleError, parseBody } from '@/lib/reportService'
import { supportUpdateSchema } from '@/lib/support'
import { identify, updateSupportRequest } from '@/lib/supportServer'

export const dynamic = 'force-dynamic'

// PATCH /api/support/:id - administrators only: change a request's status and/or category.
// The message and the sender's details can never be edited (the database enforces this too).
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const patch = await parseBody(request, supportUpdateSchema)
    const row = await updateSupportRequest(await identify(request), params.id, patch)
    return NextResponse.json({ request: row })
  } catch (err) {
    return handleError(err)
  }
}
