'use client';

import { useState, useEffect, useRef } from 'react';
import { useSubmitShortcut } from '@/app/lib/useSubmitShortcut';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, MoreHorizontal, Pencil, Trash2, UserCheck, UserX } from 'lucide-react';
import { DataTable } from '@/app/components/DataTable';
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  activateUser,
  deactivateUser,
  getRolesSimple,
  type UserAdmin,
} from '@/app/lib/api';
import { useAuth } from '@/app/context/AuthContext';
import { formatDateTime } from '@/app/lib/date';
import { toast } from 'sonner';
import { useConfirm } from '@/app/components/ConfirmDialog';

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const confirm = useConfirm();
  const [users, setUsers] = useState<UserAdmin[]>([]);
  const [roles, setRoles] = useState<{ id: number; name: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserAdmin | null>(null);
  const [error, setError] = useState('');

  // Pagination state
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // TED-521: Users-table filters ('all' = no filter).
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dailyEmailFilter, setDailyEmailFilter] = useState('all');
  const [lastLoginFilter, setLastLoginFilter] = useState('all');

  // Alert dialog shown when the server blocks a delete (user has uploaded
  // data or is referenced as agent on someone else's entries).
  const [deleteBlocked, setDeleteBlocked] = useState<{
    title: string;
    message: string;
  } | null>(null);

  const fetchUsers = async () => {
    setIsLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('page_size', String(pageSize));
    if (roleFilter !== 'all') params.set('role_id', roleFilter);
    if (statusFilter !== 'all') params.set('is_active', statusFilter);
    if (dailyEmailFilter !== 'all') params.set('daily_email_enabled', dailyEmailFilter);
    if (lastLoginFilter !== 'all') params.set('last_login', lastLoginFilter);

    const result = await getUsers(params);
    if (result.data) {
      setUsers(result.data.results || []);
      setTotalCount(result.data.count || 0);
    }
    setIsLoading(false);
  };

  const fetchRoles = async () => {
    const result = await getRolesSimple();
    if (result.data) {
      setRoles(Array.isArray(result.data) ? result.data : []);
    }
  };

  useEffect(() => {
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, roleFilter, statusFilter, dailyEmailFilter, lastLoginFilter]);

  useEffect(() => {
    fetchRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (formData: Partial<UserAdmin>) => {
    setError('');
    if (editingUser) {
      const result = await updateUser(editingUser.id, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
    } else {
      const result = await createUser(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
    }
    setIsModalOpen(false);
    setEditingUser(null);
    fetchUsers();
  };

  const handleDelete = async (user: UserAdmin) => {
    const ok = await confirm({
      title: 'Delete user?',
      description: `Are you sure you want to delete ${user.email}? This action cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const result = await deleteUser(user.id);
    if (result.error) {
      // Block-delete errors (user has uploaded data, or is referenced as an
      // agent on someone else's entries) deserve a dialog, not a toast.
      setDeleteBlocked({
        title: 'Cannot delete user',
        message: result.error,
      });
    } else {
      toast.success('User deleted');
      fetchUsers();
    }
  };

  const handleToggleActive = async (user: UserAdmin) => {
    if (user.is_active) {
      const result = await deactivateUser(user.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('User deactivated');
        fetchUsers();
      }
    } else {
      const result = await activateUser(user.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('User activated');
        fetchUsers();
      }
    }
  };

  // TED-477: inline toggle in the table — PATCH just the daily_email_enabled
  // flag and re-fetch so the row reflects the saved state.
  const handleToggleDailyEmail = async (user: UserAdmin) => {
    const next = !user.daily_email_enabled;
    const result = await updateUser(user.id, { daily_email_enabled: next });
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(
      next ? 'Daily email enabled' : 'Daily email disabled',
    );
    fetchUsers();
  };

  const hasActiveFilters =
    roleFilter !== 'all' ||
    statusFilter !== 'all' ||
    dailyEmailFilter !== 'all' ||
    lastLoginFilter !== 'all';

  const clearFilters = () => {
    setRoleFilter('all');
    setStatusFilter('all');
    setDailyEmailFilter('all');
    setLastLoginFilter('all');
    setPage(1);
  };

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (user: UserAdmin) => (
        <div className="font-medium">
          {user.full_name}
          {user.is_staff && (
            <Badge variant="secondary" className="ml-2">
              Admin
            </Badge>
          )}
        </div>
      ),
    },
    { key: 'email', header: 'Email' },
    {
      key: 'role_name',
      header: 'Role',
      render: (user: UserAdmin) => user.role_name || '-'
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (user: UserAdmin) => (
        <Badge variant={user.is_active ? 'default' : 'destructive'}>
          {user.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'date_joined',
      header: 'Joined',
      render: (user: UserAdmin) => formatDateTime(user.date_joined),
    },
    {
      key: 'last_login',
      header: 'Last Login',
      render: (user: UserAdmin) => user.last_login ? formatDateTime(user.last_login) : 'Never',
    },
    {
      key: 'daily_email_enabled',
      header: 'Daily Email',
      render: (user: UserAdmin) => (
        <div className="flex items-center space-x-2">
          <Checkbox
            id={`daily-email-${user.id}`}
            checked={user.daily_email_enabled}
            onCheckedChange={() => handleToggleDailyEmail(user)}
            aria-label={
              user.daily_email_enabled
                ? 'Disable daily email reminder'
                : 'Enable daily email reminder'
            }
          />
          <Label
            htmlFor={`daily-email-${user.id}`}
            className="text-xs text-muted-foreground cursor-pointer"
          >
            {user.daily_email_enabled ? 'On' : 'Off'}
          </Label>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (user: UserAdmin) => (
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setEditingUser(user);
                  setError('');
                  setIsModalOpen(true);
                }}
              >
                <Pencil className="h-4 w-4 mr-2" /> Edit
              </DropdownMenuItem>
              {currentUser?.id !== user.id && (
                <>
                  <DropdownMenuItem onClick={() => handleToggleActive(user)}>
                    {user.is_active ? (
                      <>
                        <UserX className="h-4 w-4 mr-2" /> Deactivate
                      </>
                    ) : (
                      <>
                        <UserCheck className="h-4 w-4 mr-2" /> Activate
                      </>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleDelete(user)}
                    className="text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" /> Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-muted-foreground">Manage user accounts and permissions</p>
        </div>
        <Button
          onClick={() => {
            setEditingUser(null);
            setError('');
            setIsModalOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" /> Add User
        </Button>
      </div>

      {/* TED-521: filter the user list by role, status, daily email, last login */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[180px] h-9 shadow-none">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="none">No Role</SelectItem>
            {roles.map((role) => (
              <SelectItem key={role.id} value={String(role.id)}>
                {role.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[150px] h-9 shadow-none">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="true">Active</SelectItem>
            <SelectItem value="false">Inactive</SelectItem>
          </SelectContent>
        </Select>

        <Select value={dailyEmailFilter} onValueChange={(v) => { setDailyEmailFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[170px] h-9 shadow-none">
            <SelectValue placeholder="Daily Email" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Daily Email</SelectItem>
            <SelectItem value="true">Enabled</SelectItem>
            <SelectItem value="false">Disabled</SelectItem>
          </SelectContent>
        </Select>

        <Select value={lastLoginFilter} onValueChange={(v) => { setLastLoginFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[160px] h-9 shadow-none">
            <SelectValue placeholder="Last Login" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any Last Login</SelectItem>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="yesterday">Yesterday</SelectItem>
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={users}
        totalCount={totalCount}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        isLoading={isLoading}
        height="h-[calc(100vh-250px)]"
      />

      <Dialog
        open={isModalOpen}
        onOpenChange={() => {
          setIsModalOpen(false);
          setEditingUser(null);
          setError('');
        }}

      >
        <DialogContent className='p-0 max-h-[90vh] flex flex-col'>
          <DialogHeader className='border-b border-[#E4E4E4] p-4 shrink-0'>
            <DialogTitle>{editingUser ? 'Edit User' : 'Add New User'}</DialogTitle>
          </DialogHeader>
          <UserForm
            user={editingUser}
            roles={roles}
            onSave={handleSave}
            onClose={() => setIsModalOpen(false)}
            error={error}
          />
        </DialogContent>
      </Dialog>

      {/* Single-button alert dialog for blocked deletes (user has uploaded
          data or is referenced as agent). Replaces the toast that used to
          fire here, since admins need to read the longer message. */}
      <Dialog
        open={deleteBlocked !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteBlocked(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{deleteBlocked?.title ?? 'Cannot delete user'}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{deleteBlocked?.message}</p>
          <DialogFooter>
            <Button onClick={() => setDeleteBlocked(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UserForm({
  user,
  roles,
  onSave,
  onClose,
  error,
}: {
  user: UserAdmin | null;
  roles: { id: number; name: string }[];
  onSave: (data: Partial<UserAdmin>) => void;
  onClose: () => void;
  error: string;
}) {
  const buildInitial = (u: UserAdmin | null) => ({
    email: u?.email ?? '',
    full_name: u?.full_name ?? '',
    role_id: u?.role_id ?? (null as number | null),
    is_staff: u?.is_staff ?? false,
    is_active: u?.is_active ?? true,
    // TED-477: opt the user IN to the daily login reminder by default.
    daily_email_enabled: u?.daily_email_enabled ?? true,
  });

  // Lazy initializer reads the user prop on FIRST render so Radix Select
  // mounts with the correct value already in place — avoids the well-known
  // Radix bug where the trigger label doesn't refresh after value prop change.
  const [formData, setFormData] = useState(() => buildInitial(user));
  const [isSubmitting, setIsSubmitting] = useState(false);
  // TED-484: Ctrl+Enter / Cmd+Enter submits via the form's onSubmit handler.
  const formRef = useRef<HTMLFormElement>(null);
  useSubmitShortcut(formRef);

  // If the user prop changes while the form is mounted (rare, since the
  // Dialog unmounts content on close), resync.
  useEffect(() => {
    setFormData(buildInitial(user));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await onSave(formData);
    setIsSubmitting(false);
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
      <div className="space-y-4 px-4 py-4 overflow-y-auto flex-1 min-h-0">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}
      <div className="space-y-2">
        <Label>Email</Label>
        <Input
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          required
        />
      </div>
      <div className="space-y-2">
        <Label>Full Name</Label>
        <Input
          value={formData.full_name}
          onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label>Role</Label>
        {roles.length === 0 ? (
          <div className="h-9 px-3 flex items-center rounded-md border border-[#E4E4E4] bg-[#F9F9F9] text-sm text-[#9CA3AF]">
            Loading roles…
          </div>
        ) : (
          <Select
            key={`${user?.id ?? 'new'}-${roles.length}`}
            value={formData.role_id?.toString() ?? 'none'}
            onValueChange={(value) =>
              setFormData({ ...formData, role_id: value === 'none' ? null : Number(value) })
            }
          >
            <SelectTrigger className="w-full shadow-none">
              <SelectValue placeholder="Select a role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No Role</SelectItem>
              {roles.map((role) => (
                <SelectItem key={role.id} value={role.id.toString()}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="is_staff"
            checked={formData.is_staff}
            onCheckedChange={(checked) => setFormData({ ...formData, is_staff: !!checked })}
          />
          <Label htmlFor="is_staff">Administrator</Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox
            id="is_active"
            checked={formData.is_active}
            onCheckedChange={(checked) => setFormData({ ...formData, is_active: !!checked })}
          />
          <Label htmlFor="is_active">Active</Label>
        </div>
      </div>
      <div className="flex items-center space-x-2">
        <Checkbox
          id="daily_email_enabled"
          checked={formData.daily_email_enabled}
          onCheckedChange={(checked) =>
            setFormData({ ...formData, daily_email_enabled: !!checked })
          }
        />
        <Label htmlFor="daily_email_enabled">Daily email reminder</Label>
      </div>
      </div>
      <DialogFooter className='p-4 border-t border-[#E4E4E4] shrink-0'>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : user ? 'Update' : 'Create'}
        </Button>
      </DialogFooter>
    </form>
  );
}
