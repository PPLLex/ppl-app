// In production, use /api (proxied through Next.js rewrites to avoid CORS)
// In dev, point directly at the Express backend
const API_URL = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? '/api' : 'http://localhost:4000/api');

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('ppl_token');
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const token = this.getToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    };

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      // Token expired or invalid — clear it and redirect to login
      if (response.status === 401 && typeof window !== 'undefined') {
        localStorage.removeItem('ppl_token');
        window.location.href = '/login?expired=true';
        throw new ApiError(401, 'Session expired. Please log in again.');
      }
      throw new ApiError(response.status, data.message || 'Something went wrong');
    }

    return data;
  }

  // Auth
  async login(email: string, password: string) {
    return this.request<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async register(data: RegisterData) {
    return this.request<{ token: string; user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getMe() {
    return this.request<User>('/auth/me');
  }

  // OAuth / Social Login
  async googleAuth(data: { idToken: string; locationId?: string; ageGroup?: string }) {
    return this.request<OAuthResult>('/auth/google', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async appleAuth(data: { identityToken: string; authorizationCode?: string; fullName?: { givenName: string; familyName: string }; locationId?: string; ageGroup?: string }) {
    return this.request<OAuthResult>('/auth/apple', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async sendMagicLink(email: string) {
    return this.request<{ message: string }>('/auth/magic-link', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async verifyMagicLink(token: string) {
    return this.request<OAuthResult>('/auth/magic-link/verify', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  // Locations
  async getLocations() {
    return this.request<Location[]>('/locations');
  }

  async getLocation(id: string) {
    return this.request<Location>(`/locations/${id}`);
  }

  async createLocation(data: Partial<Location>) {
    return this.request<Location>('/locations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateLocation(id: string, data: Partial<Location>) {
    return this.request<Location>(`/locations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async createRoom(locationId: string, data: { name: string }) {
    return this.request<Room>(`/locations/${locationId}/rooms`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async reassignClientLocation(locationId: string, clientId: string) {
    return this.request(`/locations/${locationId}/clients/${clientId}`, {
      method: 'PUT',
    });
  }

  // Sessions
  async getSessions(params: { locationId?: string; start?: string; end?: string; type?: string }) {
    const query = new URLSearchParams();
    if (params.locationId) query.set('locationId', params.locationId);
    if (params.start) query.set('start', params.start);
    if (params.end) query.set('end', params.end);
    if (params.type) query.set('type', params.type);
    return this.request<SessionWithAvailability[]>(`/sessions?${query.toString()}`);
  }

  async getSession(id: string) {
    return this.request<Session>(`/sessions/${id}`);
  }

  async getSessionDetail(id: string) {
    return this.request<SessionDetail>(`/sessions/${id}`);
  }

  async createSession(data: CreateSessionData) {
    return this.request<{ count: number; recurringGroupId: string | null }>('/sessions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSession(id: string, data: Partial<CreateSessionData>) {
    return this.request<Session>(`/sessions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteSession(id: string) {
    return this.request(`/sessions/${id}`, { method: 'DELETE' });
  }

  // Bookings
  async bookSession(sessionId: string) {
    return this.request<Booking>('/bookings', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
  }

  async cancelBooking(id: string, reason?: string) {
    return this.request<{ creditRestored: boolean }>(`/bookings/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
    });
  }

  async getUpcomingBookings(params?: { upcoming?: boolean; status?: string }) {
    const query = new URLSearchParams();
    if (params?.upcoming) query.set('upcoming', 'true');
    if (params?.status) query.set('status', params.status);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request<Booking[]>(`/bookings/my${qs}`);
  }

  async markAttendance(bookingId: string, status: 'COMPLETED' | 'NO_SHOW') {
    return this.request(`/bookings/${bookingId}/attendance`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
  }

  // Memberships
  async getMembershipPlans() {
    return this.request<MembershipPlan[]>('/memberships/plans');
  }

  async getMyMembership() {
    return this.request<MembershipDetail | null>('/memberships/my');
  }

  async subscribe(planId: string) {
    return this.request<SubscribeResult>('/memberships/subscribe', {
      method: 'POST',
      body: JSON.stringify({ planId }),
    });
  }

  async requestCardChange(notes?: string) {
    return this.request('/memberships/card-change-request', {
      method: 'POST',
      body: JSON.stringify({ notes }),
    });
  }

  async requestCancellation(reason?: string) {
    return this.request('/memberships/cancel-request', {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  // Admin memberships
  async getMemberships(params?: { status?: string; locationId?: string; page?: number }) {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.locationId) query.set('locationId', params.locationId);
    if (params?.page) query.set('page', params.page.toString());
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request<MembershipWithClient[]>(`/memberships${qs}`);
  }

  async getPastDueMemberships() {
    return this.request<MembershipWithClient[]>('/memberships/past-due');
  }

  async getCancelRequests() {
    return this.request<MembershipWithClient[]>('/memberships/cancel-requests');
  }

  async getCardChangeRequests() {
    return this.request<CardChangeRequestWithClient[]>('/memberships/card-change-requests');
  }

  async getMembershipStats() {
    return this.request<MembershipStats>('/memberships/stats');
  }

  async adminCancelMembership(membershipId: string) {
    return this.request(`/memberships/${membershipId}/cancel`, { method: 'POST' });
  }

  async adminRetryPayment(membershipId: string) {
    return this.request(`/memberships/${membershipId}/retry-payment`, { method: 'POST' });
  }

  async sendCardUpdateLink(requestId: string) {
    return this.request(`/memberships/card-change-requests/${requestId}/send-link`, {
      method: 'POST',
    });
  }

  // Members
  async getMembers(params?: { search?: string; locationId?: string; ageGroup?: string; status?: string; page?: number }) {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.locationId) query.set('locationId', params.locationId);
    if (params?.ageGroup) query.set('ageGroup', params.ageGroup);
    if (params?.status) query.set('status', params.status);
    if (params?.page) query.set('page', params.page.toString());
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request<ClientListItem[]>(`/members${qs}`);
  }

  async getMember(id: string) {
    return this.request<ClientDetail>(`/members/${id}`);
  }

  async updateClientNotes(id: string, data: { notes?: string; trainingGoals?: string }) {
    return this.request(`/members/${id}/notes`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deactivateClient(id: string) {
    return this.request(`/members/${id}/deactivate`, { method: 'PUT' });
  }

  // Staff management
  async getStaffList() {
    return this.request<StaffMember[]>('/staff');
  }

  async inviteStaff(data: { fullName: string; email: string; password: string; role: string; phone?: string }) {
    return this.request<StaffMember>('/staff/invite', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Membership plan management (admin)
  async createMembershipPlan(data: Partial<MembershipPlan> & { priceCents: number }) {
    return this.request<MembershipPlan>('/memberships/plans', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateMembershipPlan(id: string, data: Partial<MembershipPlan>) {
    return this.request<MembershipPlan>(`/memberships/plans/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Reassign client to location
  async reassignClient(locationId: string, clientId: string) {
    return this.request(`/locations/${locationId}/clients/${clientId}`, {
      method: 'PUT',
    });
  }

  // Conversations / Messaging
  async getConversations() {
    return this.request<ConversationSummary[]>('/conversations');
  }

  async getContacts() {
    return this.request<Contact[]>('/conversations/contacts');
  }

  async startConversation(data: { recipientId: string; message: string; type?: string }) {
    return this.request<{ conversationId: string; message: MessageData }>('/conversations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getMessages(conversationId: string, page = 1) {
    return this.request<MessageData[]>(`/conversations/${conversationId}/messages?page=${page}&limit=50`);
  }

  async sendMessage(conversationId: string, content: string) {
    return this.request<MessageData>(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }

  // Reports / Analytics
  async getRevenueStats(params?: { period?: string; locationId?: string }) {
    const query = new URLSearchParams();
    if (params?.period) query.set('period', params.period);
    if (params?.locationId) query.set('locationId', params.locationId);
    return this.request<RevenueStats>(`/reports/revenue?${query}`);
  }

  async getBookingStats(params?: { period?: string; locationId?: string }) {
    const query = new URLSearchParams();
    if (params?.period) query.set('period', params.period);
    if (params?.locationId) query.set('locationId', params.locationId);
    return this.request<BookingStats>(`/reports/bookings?${query}`);
  }

  async getMemberStats() {
    return this.request<MemberStats>('/reports/members');
  }

  // Notifications
  async getNotifications(params?: { unread?: boolean; page?: number }) {
    const query = new URLSearchParams();
    if (params?.unread) query.set('unread', 'true');
    if (params?.page) query.set('page', params.page.toString());
    return this.request<AppNotification[]>(`/notifications?${query}`);
  }

  async markNotificationRead(id: string) {
    return this.request(`/notifications/${id}/read`, { method: 'PUT' });
  }

  async markAllNotificationsRead() {
    return this.request('/notifications/read-all', { method: 'PUT' });
  }

  // Onboarding
  async setOnboardingStatus(selection: 'new' | 'returning' | 'youth_graduate' | 'free_assessment') {
    return this.request<{ onboardingRecord: OnboardingRecord; requiresPayment: boolean }>('/onboarding/status', {
      method: 'POST',
      body: JSON.stringify({ selection }),
    });
  }

  async createOnboardingCheckout() {
    return this.request<{ checkoutUrl: string } | { alreadyPaid: boolean; feeStatus: string }>('/onboarding/checkout', {
      method: 'POST',
    });
  }

  async confirmOnboardingPayment() {
    return this.request<{ paid: boolean; feeStatus?: string }>('/onboarding/confirm-payment', {
      method: 'POST',
    });
  }

  async getOnboardingStatus() {
    return this.request<{
      hasProfile: boolean;
      onboardingRecord: OnboardingRecord | null;
      requiresPayment: boolean;
      isComplete: boolean;
    }>('/onboarding/me');
  }

  // Account / Profile
  async getProfile() {
    return this.request<UserProfile>('/account/profile');
  }

  async updateProfile(data: Partial<UserProfile>) {
    return this.request('/account/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async changePassword(data: { currentPassword: string; newPassword: string }) {
    return this.request('/account/password', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async forgotPassword(email: string) {
    return this.request('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async resetPassword(data: { token: string; newPassword: string }) {
    return this.request('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Booking History
  async getMyBookings(params?: { status?: string; page?: number }) {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.page) query.set('page', params.page.toString());
    return this.request<BookingHistoryItem[]>(`/account/bookings?${query}`);
  }

  // Audit Logs (admin)
  async getAuditLogs(params?: { page?: number; action?: string; resourceType?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', params.page.toString());
    if (params?.action) query.set('action', params.action);
    if (params?.resourceType) query.set('resourceType', params.resourceType);
    return this.request<AuditLogEntry[]>(`/audit-logs?${query}`);
  }

  // ============================================================
  // COACH NOTES
  // ============================================================

  async createCoachNote(data: { athleteId: string; trainingCategory: string; content: string; sessionDate?: string; bookingId?: string }) {
    return this.request<CoachNote>('/coach-notes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getAthleteNotes(athleteId: string, params?: { category?: string; limit?: number; offset?: number }) {
    const query = new URLSearchParams();
    if (params?.category) query.set('category', params.category);
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.offset) query.set('offset', params.offset.toString());
    return this.request<CoachNote[]>(`/coach-notes/athlete/${athleteId}?${query}`);
  }

  async getMyCoachNotes(params?: { limit?: number; offset?: number }) {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.offset) query.set('offset', params.offset.toString());
    return this.request<CoachNote[]>(`/coach-notes/my-notes?${query}`);
  }

  async updateCoachNote(noteId: string, data: { content?: string; trainingCategory?: string }) {
    return this.request<CoachNote>(`/coach-notes/${noteId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteCoachNote(noteId: string) {
    return this.request(`/coach-notes/${noteId}`, { method: 'DELETE' });
  }

  async getTrainingCategories() {
    return this.request<TrainingCategoryOption[]>('/coach-notes/categories');
  }

  // Digest Recipients
  async getDigestRecipients(athleteId: string) {
    return this.request<DigestRecipient[]>(`/coach-notes/recipients/${athleteId}`);
  }

  async addDigestRecipient(athleteId: string, data: { email: string; name?: string; relation?: string }) {
    return this.request<DigestRecipient>(`/coach-notes/recipients/${athleteId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async removeDigestRecipient(recipientId: string) {
    return this.request(`/coach-notes/recipients/remove/${recipientId}`, { method: 'DELETE' });
  }

  // ============================================================
  // GOALS
  // ============================================================

  async createGoal(data: { athleteId?: string; type: string; title: string; description?: string; targetDate?: string }) {
    return this.request<Goal>('/goals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getAthleteGoals(athleteId: string, params?: { status?: string; type?: string }) {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.type) query.set('type', params.type);
    return this.request<Goal[]>(`/goals/athlete/${athleteId}?${query}`);
  }

  async updateGoal(goalId: string, data: { title?: string; description?: string; targetDate?: string; progress?: number; status?: string }) {
    return this.request<Goal>(`/goals/${goalId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteGoal(goalId: string) {
    return this.request(`/goals/${goalId}`, { method: 'DELETE' });
  }

  // ============================================================
  // FORMS
  // ============================================================

  async createForm(data: { title: string; description?: string; fields: FormField[]; isOnboarding?: boolean }) {
    return this.request<FormTemplate>('/forms', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getForms(params?: { onboarding?: boolean }) {
    const query = new URLSearchParams();
    if (params?.onboarding !== undefined) query.set('onboarding', params.onboarding.toString());
    return this.request<FormTemplate[]>(`/forms?${query}`);
  }

  async getForm(formId: string) {
    return this.request<FormTemplate>(`/forms/${formId}`);
  }

  async updateForm(formId: string, data: { title?: string; description?: string; fields?: FormField[]; isOnboarding?: boolean; isActive?: boolean }) {
    return this.request<FormTemplate>(`/forms/${formId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async submitFormResponse(formId: string, answers: Record<string, unknown>, athleteId?: string) {
    return this.request<FormResponse>(`/forms/${formId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ answers, athleteId }),
    });
  }

  async getFormResponses(formId: string) {
    return this.request<FormResponse[]>(`/forms/${formId}/responses`);
  }

  async getMyFormResponse(formId: string) {
    return this.request<FormResponse | null>(`/forms/${formId}/my-response`);
  }

  // ============================================================
  // PROGRAMS / WORKOUT BUILDER
  // ============================================================

  async createProgram(data: { athleteId: string; title: string; description?: string; startDate?: string; endDate?: string }) {
    return this.request<Program>('/programs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getAthletePrograms(athleteId: string, params?: { status?: string }) {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    return this.request<Program[]>(`/programs/athlete/${athleteId}?${query}`);
  }

  async getProgram(programId: string) {
    return this.request<Program>(`/programs/${programId}`);
  }

  async updateProgram(programId: string, data: { title?: string; description?: string; status?: string; startDate?: string; endDate?: string }) {
    return this.request<Program>(`/programs/${programId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async addProgramWeek(programId: string, data?: { weekNum?: number; title?: string }) {
    return this.request<ProgramWeek>(`/programs/${programId}/weeks`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  }

  async addProgramDay(weekId: string, data: { dayNum: number; title?: string; notes?: string }) {
    return this.request<ProgramDay>(`/programs/weeks/${weekId}/days`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async addProgramExercise(dayId: string, data: { exerciseId?: string; customName?: string; sets?: number; reps?: string; intensity?: string; restSeconds?: number; tempo?: string; notes?: string }) {
    return this.request<ProgramExercise>(`/programs/days/${dayId}/exercises`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateProgramExercise(exerciseId: string, data: { sets?: number; reps?: string; intensity?: string; restSeconds?: number; tempo?: string; notes?: string; sortOrder?: number }) {
    return this.request<ProgramExercise>(`/programs/exercises/${exerciseId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteProgramExercise(exerciseId: string) {
    return this.request(`/programs/exercises/${exerciseId}`, { method: 'DELETE' });
  }

  async getExerciseLibrary(category?: string) {
    const query = new URLSearchParams();
    if (category) query.set('category', category);
    return this.request<ExerciseLibraryItem[]>(`/programs/exercises/library?${query}`);
  }

  async addExerciseToLibrary(data: { name: string; category: string; equipment?: string; description?: string; videoUrl?: string }) {
    return this.request<ExerciseLibraryItem>('/programs/exercises/library', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
}

// Types
export interface User {
  id: string;
  email: string;
  fullName: string;
  phone?: string;
  role: 'ADMIN' | 'STAFF' | 'CLIENT';
  homeLocation?: { id: string; name: string };
  ageGroup?: string;
  memberships?: Membership[];
}

export interface OAuthResult {
  token: string;
  user: User;
  isNewUser: boolean;
}

export interface RegisterData {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  locationId: string;
  ageGroup?: string;
}

export interface Location {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  timezone: string;
  operatingHours?: Record<string, { open: string; close: string } | null>;
  closedDay?: string;
  isActive?: boolean;
  rooms?: Room[];
}

export interface Room {
  id: string;
  name: string;
  sortOrder: number;
  isActive?: boolean;
}

export interface Session {
  id: string;
  locationId: string;
  title: string;
  sessionType: string;
  startTime: string;
  endTime: string;
  maxCapacity: number;
  currentEnrolled: number;
  registrationCutoffHours: number;
  cancellationCutoffHours: number;
  coach?: { id: string; fullName: string };
  room?: Room;
  recurringGroupId?: string | null;
}

export interface SessionWithAvailability extends Session {
  spotsRemaining: number;
}

export interface SessionDetail extends SessionWithAvailability {
  bookings: Array<{
    id: string;
    status: string;
    creditsUsed: number;
    client: { id: string; fullName: string; phone: string | null };
  }>;
}

export interface CreateSessionData {
  locationId: string;
  roomId?: string;
  title: string;
  sessionType: string;
  startTime: string;
  endTime: string;
  maxCapacity?: number;
  registrationCutoffHours?: number;
  cancellationCutoffHours?: number;
  recurringRule?: string;
  recurringCount?: number;
}

export interface Booking {
  id: string;
  clientId: string;
  sessionId: string;
  status: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  creditsUsed: number;
  cancelledAt?: string;
  createdAt: string;
  session: Session & {
    room?: { name: string };
    coach?: { fullName: string };
  };
}

export interface Membership {
  id: string;
  status: string;
  plan: {
    id: string;
    name: string;
    sessionsPerWeek: number | null;
    priceCents: number;
  };
  billingDay: string;
}

export interface MembershipPlan {
  id: string;
  name: string;
  slug: string;
  ageGroup: string;
  sessionsPerWeek: number | null;
  priceCents: number;
  billingCycle: string;
  description: string | null;
  isActive: boolean;
}

export interface MembershipDetail {
  membership: {
    id: string;
    clientId: string;
    planId: string;
    locationId: string;
    status: string;
    billingDay: string;
    billingAnchorDate: string;
    startedAt: string;
    cancelRequestedAt: string | null;
    plan: MembershipPlan;
    location: { id: string; name: string };
  };
  credits: {
    total: number;
    used: number;
    remaining: number;
    weekStart: string;
    weekEnd: string;
  } | null;
  recentPayments: PaymentRecord[];
}

export interface PaymentRecord {
  id: string;
  amountCents: number;
  status: string;
  failureReason: string | null;
  createdAt: string;
}

export interface SubscribeResult {
  subscriptionId: string;
  clientSecret: string;
  billingDay: string;
  billingAnchorDate: string;
  plan: MembershipPlan;
}

export interface MembershipWithClient {
  id: string;
  status: string;
  billingDay: string;
  startedAt: string;
  cancelRequestedAt: string | null;
  client: { id: string; fullName: string; email: string; phone: string | null };
  plan: MembershipPlan;
  location: { id: string; name: string };
  payments?: PaymentRecord[];
}

export interface CardChangeRequestWithClient {
  id: string;
  clientId: string;
  status: string;
  notes: string | null;
  createdAt: string;
  client: { id: string; fullName: string; email: string; phone: string | null };
}

export interface MembershipStats {
  activeMemberships: number;
  pastDueMemberships: number;
  cancelledMemberships: number;
  totalRevenueCents: number;
  pendingCancelRequests: number;
  pendingCardChangeRequests: number;
}

export interface ClientListItem {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  ageGroup: string | null;
  location: { id: string; name: string } | null;
  membership: {
    status: string;
    plan: { id: string; name: string; sessionsPerWeek: number | null; priceCents: number };
  } | null;
  totalBookings: number;
  joinedAt: string;
  notes: string | null;
  trainingGoals: string | null;
}

export interface ClientDetail {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  homeLocation: { id: string; name: string } | null;
  clientProfile: {
    ageGroup: string | null;
    notes: string | null;
    trainingGoals: string | null;
    trainingPreference: 'IN_PERSON' | 'REMOTE' | 'HYBRID' | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
  } | null;
  clientMemberships: Array<{
    id: string;
    status: string;
    billingDay: string;
    startedAt: string;
    plan: MembershipPlan;
    location: { id: string; name: string };
  }>;
  bookings: Array<{
    id: string;
    status: string;
    createdAt: string;
    session: {
      title: string;
      startTime: string;
      sessionType: string;
      room: { name: string } | null;
      coach: { fullName: string } | null;
    };
  }>;
  payments: PaymentRecord[];
}

// Account / Profile types
export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: string;
  createdAt: string;
  clientProfile?: {
    dateOfBirth: string | null;
    ageGroup: string;
    parentName: string | null;
    parentEmail: string | null;
    parentPhone: string | null;
    emergencyContact: string | null;
    emergencyPhone: string | null;
    trainingGoals: string | null;
    trainingPreference: 'IN_PERSON' | 'REMOTE' | 'HYBRID' | null;
    waiverSignedAt: string | null;
  };
  homeLocation?: { id: string; name: string } | null;
}

export interface BookingHistoryItem {
  id: string;
  status: string;
  createdAt: string;
  cancelledAt: string | null;
  session: {
    id: string;
    title: string;
    type: string;
    startTime: string;
    endTime: string;
    locationName: string;
    roomName: string | null;
  };
}

export interface AuditLogEntry {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  changes: Record<string, unknown> | null;
  userName: string;
  userRole: string | null;
  createdAt: string;
}

// Messaging types
export interface ConversationSummary {
  id: string;
  type: string;
  locationId: string | null;
  locationName: string | null;
  participants: { id: string; fullName: string; role: string }[];
  lastMessage: {
    id: string;
    content: string;
    senderId: string;
    senderName: string;
    createdAt: string;
  } | null;
  unreadCount: number;
  updatedAt: string;
}

export interface Contact {
  id: string;
  fullName: string;
  email: string;
  role: string;
}

export interface MessageData {
  id: string;
  content: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  readBy: string[];
  createdAt: string;
}

// Reports types
export interface RevenueStats {
  totalRevenue: number;
  periodRevenue: number;
  averagePerMember: number;
  pastDueAmount: number;
  revenueByPlan: { plan: string; revenue: number; members: number }[];
  revenueByMonth: { month: string; revenue: number }[];
}

export interface BookingStats {
  totalBookings: number;
  periodBookings: number;
  averagePerSession: number;
  utilizationRate: number;
  bookingsByType: { type: string; count: number }[];
  bookingsByDay: { day: string; count: number }[];
  popularTimes: { hour: number; count: number }[];
}

export interface MemberStats {
  totalActive: number;
  totalInactive: number;
  newThisMonth: number;
  churnRate: number;
  byAgeGroup: { ageGroup: string; count: number }[];
  byPlan: { plan: string; count: number }[];
  byLocation: { location: string; count: number }[];
}

// Notification types
export interface AppNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  channel: string;
  status: string;
  metadata: Record<string, unknown> | null;
  sentAt: string | null;
  createdAt: string;
}

export interface StaffMember {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: 'ADMIN' | 'STAFF';
  locations: { id: string; name: string }[];
}

// Coach Notes types
export interface CoachNote {
  id: string;
  athleteId: string;
  coachId: string;
  trainingCategory: string;
  rawContent: string;
  cleanedContent: string | null;
  content: string; // computed: cleaned || raw
  sessionDate: string;
  bookingId: string | null;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
  coach: { id: string; fullName: string };
  athlete?: { id: string; fullName: string };
  booking?: {
    id: string;
    session: {
      id: string;
      title: string;
      sessionType: string;
      startTime: string;
    };
  } | null;
}

export interface TrainingCategoryOption {
  value: string;
  label: string;
}

export interface DigestRecipient {
  id: string;
  athleteId: string;
  email: string;
  name: string | null;
  relation: string | null;
  isActive: boolean;
  createdAt: string;
}

// Goals types
export interface Goal {
  id: string;
  athleteId: string;
  coachId: string | null;
  type: 'SHORT_TERM' | 'LONG_TERM';
  title: string;
  description: string | null;
  targetDate: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
  progress: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  athlete?: { id: string; fullName: string };
  coach?: { id: string; fullName: string } | null;
}

// Forms types
export interface FormField {
  name: string;
  type: 'text' | 'number' | 'select' | 'checkbox' | 'textarea' | 'date' | 'email' | 'phone' | 'multiselect';
  label: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

export interface FormTemplate {
  id: string;
  createdById: string;
  title: string;
  description: string | null;
  fields: FormField[];
  isOnboarding: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: { id: string; fullName: string };
  _count?: { responses: number };
  isCompleted?: boolean; // for client view
}

export interface FormResponse {
  id: string;
  formId: string;
  athleteId: string;
  answers: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  athlete?: { id: string; fullName: string; email: string };
}

// Program / Workout Builder types
export interface Program {
  id: string;
  coachId: string;
  athleteId: string;
  title: string;
  description: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
  coach: { id: string; fullName: string };
  athlete?: { id: string; fullName: string };
  weeks?: ProgramWeek[];
}

export interface ProgramWeek {
  id: string;
  programId: string;
  weekNum: number;
  title: string | null;
  days?: ProgramDay[];
}

export interface ProgramDay {
  id: string;
  weekId: string;
  dayNum: number;
  title: string | null;
  notes: string | null;
  exercises?: ProgramExercise[];
}

export interface ProgramExercise {
  id: string;
  dayId: string;
  sortOrder: number;
  exerciseId: string | null;
  customName: string | null;
  sets: number | null;
  reps: string | null;
  intensity: string | null;
  restSeconds: number | null;
  tempo: string | null;
  notes: string | null;
  exercise?: ExerciseLibraryItem | null;
}

export interface ExerciseLibraryItem {
  id: string;
  name: string;
  category: string;
  equipment: string | null;
  description: string | null;
  videoUrl: string | null;
  isActive: boolean;
}

export interface OnboardingRecord {
  id: string;
  athleteId: string;
  onboardingStatus: 'NEW' | 'RETURNING';
  feeStatus: 'REQUIRED' | 'PROCESSING' | 'PAID' | 'WAIVED' | 'NOT_APPLICABLE';
  onboardingFeeCents: number;
  stripePaymentId?: string;
  stripeCheckoutId?: string;
  isYouthGraduate: boolean;
  hadFreeAssessment: boolean;
  qualifyingAnswers?: Record<string, unknown>;
  selfReportedStatus?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const api = new ApiClient(API_URL);
