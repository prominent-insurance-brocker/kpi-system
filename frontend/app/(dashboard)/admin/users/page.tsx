'use client';

import { useState, useEffect } from 'react';
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

export default function UsersPage() {
  const { user: currentUser } = useAuth();
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

  const fetchUsers = async () => {
    setIsLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('page_size', String(pageSize));

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
    fetchRoles();
  }, [page, pageSize]); // Re-fetch when page or pageSize changes

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
    if (!confirm(`Are you sure you want to delete ${user.email}?`)) return;
    const result = await deleteUser(user.id);
    if (result.error) {
      alert(result.error);
    } else {
      fetchUsers();
    }
  };

  const handleToggleActive = async (user: UserAdmin) => {
    if (user.is_active) {
      const result = await deactivateUser(user.id);
      if (result.error) {
        alert(result.error);
      } else {
        fetchUsers();
      }
    } else {
      const result = await activateUser(user.id);
      if (result.error) {
        alert(result.error);
      } else {
        fetchUsers();
      }
    }
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
        height="h-[calc(100vh-190px)]"
      />

      <Dialog
        open={isModalOpen}
        onOpenChange={() => {
          setIsModalOpen(false);
          setEditingUser(null);
          setError('');
        }}

      >
        <DialogContent className='p-0' >
          <DialogHeader className='border-b border-[#E4E4E4] p-4'>
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
  const [formData, setFormData] = useState({
    email: '',
    full_name: '',
    role_id: null as number | null,
    is_staff: false,
    is_active: true,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (user) {
      setFormData({
        email: user.email,
        full_name: user.full_name,
        role_id: user.role_id,
        is_staff: user.is_staff,
        is_active: user.is_active,
      });
    } else {
      setFormData({
        email: '',
        full_name: '',
        role_id: null,
        is_staff: false,
        is_active: true,
      });
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await onSave(formData);
    setIsSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 px-4">
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
          disabled={!!user}
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
        <Select
          value={formData.role_id?.toString() || 'none'}
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
      </div>
      {/* <div className="flex items-center space-x-4">
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
      </div> */}
      <DialogFooter className='py-4'>
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
