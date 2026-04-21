'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { api, ConversationSummary, Contact, MessageData } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

interface MessagePanelProps {
  /** Filter conversations by type if needed */
  conversationFilter?: (conv: ConversationSummary) => boolean;
}

export default function MessagePanel({ conversationFilter }: MessagePanelProps) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showNewConv, setShowNewConv] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      const res = await api.getConversations();
      let convs = res.data || [];
      if (conversationFilter) convs = convs.filter(conversationFilter);
      setConversations(convs);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [conversationFilter]);

  const loadMessages = useCallback(async (convId: string) => {
    try {
      const res = await api.getMessages(convId);
      if (res.data) setMessages(res.data);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    loadConversations();
    api.getContacts().then((res) => {
      if (res.data) setContacts(res.data);
    });
  }, [loadConversations]);

  // Poll for new messages every 5s
  useEffect(() => {
    if (selectedConvId) {
      loadMessages(selectedConvId);
      pollRef.current = setInterval(() => {
        loadMessages(selectedConvId);
        loadConversations();
      }, 5000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [selectedConvId, loadMessages, loadConversations]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim() || !selectedConvId || isSending) return;
    setIsSending(true);
    try {
      const res = await api.sendMessage(selectedConvId, newMessage.trim());
      if (res.data) {
        setMessages((prev) => [...prev, res.data!]);
        setNewMessage('');
        loadConversations();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSending(false);
    }
  };

  const handleStartConversation = async (contact: Contact) => {
    try {
      const res = await api.startConversation({
        recipientId: contact.id,
        message: `Hi ${contact.fullName.split(' ')[0]}!`,
      });
      if (res.data) {
        setSelectedConvId(res.data.conversationId);
        setShowNewConv(false);
        loadConversations();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const selectedConv = conversations.find((c) => c.id === selectedConvId);
  const otherParticipants = selectedConv?.participants.filter((p) => p.id !== user?.id) || [];

  const filteredContacts = contacts.filter(
    (c) =>
      c.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-8rem)]">
        <div className="w-80 border-r border-border p-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="animate-pulse h-16 bg-surface rounded-lg mb-2" />
          ))}
        </div>
        <div className="flex-1 flex items-center justify-center text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] bg-background rounded-lg border border-border overflow-hidden">
      {/* Sidebar — Conversation List */}
      <div className="w-80 border-r border-border flex flex-col">
        <div className="p-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-foreground text-sm">Messages</h3>
            <button
              onClick={() => setShowNewConv(!showNewConv)}
              className="w-7 h-7 rounded-md bg-highlight/20 text-accent-text flex items-center justify-center text-lg hover:bg-highlight/30 transition"
            >
              +
            </button>
          </div>
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="ppl-input text-xs"
          />
        </div>

        {/* New Conversation Contact Picker */}
        {showNewConv && (
          <div className="border-b border-border bg-surface/50 max-h-48 overflow-y-auto">
            <p className="px-3 pt-2 text-xs text-muted font-medium">Start a conversation with:</p>
            {filteredContacts.map((contact) => (
              <button
                key={contact.id}
                onClick={() => handleStartConversation(contact)}
                className="w-full px-3 py-2 text-left hover:bg-surface transition flex items-center gap-2"
              >
                <div className="w-7 h-7 rounded-full ppl-gradient flex items-center justify-center text-xs font-bold text-white">
                  {contact.fullName
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .slice(0, 2)}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{contact.fullName}</p>
                  <p className="text-xs text-muted">{contact.role}</p>
                </div>
              </button>
            ))}
            {filteredContacts.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted">No contacts found</p>
            )}
          </div>
        )}

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto">
          {conversations.map((conv) => {
            const others = conv.participants.filter((p) => p.id !== user?.id);
            const isSelected = conv.id === selectedConvId;
            return (
              <button
                key={conv.id}
                onClick={() => setSelectedConvId(conv.id)}
                className={`w-full px-3 py-3 text-left border-b border-border/50 transition ${
                  isSelected ? 'bg-highlight/10' : 'hover:bg-surface'
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="w-9 h-9 rounded-full ppl-gradient flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mt-0.5">
                    {others[0]?.fullName
                      .split(' ')
                      .map((n: string) => n[0])
                      .join('')
                      .slice(0, 2) || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {others.map((p) => p.fullName).join(', ') || 'Unknown'}
                      </p>
                      {conv.unreadCount > 0 && (
                        <span className="w-5 h-5 rounded-full bg-accent text-background text-xs flex items-center justify-center font-bold flex-shrink-0">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                    {conv.lastMessage && (
                      <p className="text-xs text-muted truncate mt-0.5">{conv.lastMessage.content}</p>
                    )}
                    {conv.lastMessage && (
                      <p className="text-xs text-muted/50 mt-0.5">
                        {formatTime(conv.lastMessage.createdAt)}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
          {conversations.length === 0 && (
            <div className="p-6 text-center">
              <p className="text-sm text-muted">No conversations yet</p>
              <button
                onClick={() => setShowNewConv(true)}
                className="text-sm text-accent-text hover:underline mt-1"
              >
                Start a conversation
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main — Message Thread */}
      <div className="flex-1 flex flex-col">
        {selectedConvId ? (
          <>
            {/* Thread Header */}
            <div className="px-4 py-3 border-b border-border flex items-center gap-3">
              <div className="w-9 h-9 rounded-full ppl-gradient flex items-center justify-center text-xs font-bold text-white">
                {otherParticipants[0]?.fullName
                  .split(' ')
                  .map((n: string) => n[0])
                  .join('')
                  .slice(0, 2) || '?'}
              </div>
              <div>
                <p className="font-semibold text-foreground text-sm">
                  {otherParticipants.map((p) => p.fullName).join(', ')}
                </p>
                <p className="text-xs text-muted">
                  {otherParticipants.map((p) => p.role).join(', ')}
                  {selectedConv?.locationName && ` — ${selectedConv.locationName}`}
                </p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((msg) => {
                const isMe = msg.senderId === user?.id;
                return (
                  <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[70%] rounded-2xl px-4 py-2.5 ${
                        isMe
                          ? 'bg-highlight text-on-accent rounded-br-md'
                          : 'bg-surface text-foreground rounded-bl-md'
                      }`}
                    >
                      {!isMe && (
                        <p className="text-xs font-semibold text-accent-text mb-0.5">
                          {msg.senderName}
                        </p>
                      )}
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      <p
                        className={`text-xs mt-1 ${
                          isMe ? 'text-white/50' : 'text-muted'
                        }`}
                      >
                        {formatTime(msg.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t border-border">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Type a message..."
                  className="ppl-input flex-1"
                />
                <button
                  onClick={handleSend}
                  disabled={!newMessage.trim() || isSending}
                  className="ppl-btn ppl-btn-primary px-4"
                >
                  {isSending ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-surface mx-auto mb-3 flex items-center justify-center">
                <svg className="w-8 h-8 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                </svg>
              </div>
              <p className="text-muted text-sm">Select a conversation or start a new one</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
