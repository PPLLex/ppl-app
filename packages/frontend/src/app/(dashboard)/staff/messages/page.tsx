'use client';

import MessagePanel from '@/components/messaging/MessagePanel';

export default function StaffMessagesPage() {
  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-foreground">Messages</h1>
        <p className="text-sm text-muted mt-0.5">Chat with athletes and other coaches</p>
      </div>
      <MessagePanel />
    </div>
  );
}
