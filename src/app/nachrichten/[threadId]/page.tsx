'use client';

import { useParams } from 'next/navigation';

import { WhatsAppInbox } from '@/components/WhatsAppInbox';

export default function ThreadPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const id = decodeThreadId(threadId);
  return <WhatsAppInbox threadId={id} />;
}

function decodeThreadId(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}