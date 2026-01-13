'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronsUpDown } from 'lucide-react';

interface Column<T> {
  key: keyof T | string;
  header: string;
  render?: (item: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onEdit?: (item: T) => void;
  onDelete?: (item: T) => void;
  canEdit?: (item: T) => boolean;
  isLoading?: boolean;
}

export function DataTable<T extends { id: number }>({
  columns,
  data,
  totalCount,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  onEdit,
  onDelete,
  canEdit,
  isLoading,
}: DataTableProps<T>) {
  const totalPages = Math.ceil(totalCount / pageSize);

  const getValue = (item: T, key: string): React.ReactNode => {
    const keys = key.split('.');
    let value: unknown = item;
    for (const k of keys) {
      value = (value as Record<string, unknown>)?.[k];
    }
    return value as React.ReactNode;
  };

  return (
    <div className="bg-white border border-[#E4E4E4] rounded-2xl  h-[calc(100vh-270px)]">
      <div className="p-4 flex flex-col gap-5 h-full">
        {/* Table */}
        <div className="flex flex-col rounded-lg overflow-hidden h-full">
          {/* Table Header */}
          <div className="flex bg-[#F3F3F3] rounded-lg h-12">
            {columns.map((col) => (
              <div
                key={col.key as string}
                className="flex items-center px-3 text-[#71717A] font-medium text-sm flex-1"
              >
                {col.header}
              </div>
            ))}
            {(onEdit || onDelete) && (
              <div className="flex items-center px-3 text-[#71717A] font-medium text-sm w-[100px]">
                Actions
              </div>
            )}
          </div>

          {/* Table Body */}
          <div className="flex flex-col">
            {isLoading ? (
              <div className="flex items-center justify-center h-16 border-b border-[#EDEDED]">
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
                  <span className="ml-2 text-[#71717A]">Loading...</span>
                </div>
              </div>
            ) : data.length === 0 ? (
              <div className="flex items-center justify-center h-16 border-b border-[#EDEDED] text-[#71717A]">
                No entries yet
              </div>
            ) : (
              data.map((item) => (
                <div key={item.id} className="flex h-16 border-b border-[#EDEDED]">
                  {columns.map((col) => (
                    <div
                      key={col.key as string}
                      className="flex items-center px-3 py-4 text-[#303030] text-sm font-medium flex-1"
                    >
                      {col.render ? col.render(item) : getValue(item, col.key as string)}
                    </div>
                  ))}
                  {(onEdit || onDelete) && (
                    <div className="flex items-center px-3 py-4 w-[100px]">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-gray-100">
                            <MoreHorizontal className="h-4 w-4 text-[#09090B]" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-[149px] bg-white border border-[#D4D4D4] rounded-lg p-0.5 shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.1),0px_2px_4px_-2px_rgba(0,0,0,0.1)] flex flex-col gap-2"
                        >
                          {onEdit && (!canEdit || canEdit(item)) && (
                            <DropdownMenuItem
                              onClick={() => onEdit(item)}
                              className="cursor-pointer px-3 py-2 text-sm text-[#09090B] hover:bg-[#F3F3F3] rounded-md"
                            >
                              Edit
                            </DropdownMenuItem>
                          )}
                          {onDelete && (
                            <DropdownMenuItem
                              onClick={() => onDelete(item)}
                              className="cursor-pointer px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-md"
                            >
                              Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Pagination */}
        <div className="flex justify-between items-center">
          {/* Rows per page */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[#09090B]">Rows per page</span>
            <div className="relative">
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className="appearance-none w-[72px] h-8 px-3 pr-8 text-xs text-[#09090B] bg-white border border-[#E4E4E7] rounded-md cursor-pointer focus:outline-none focus:ring-2 focus:ring-gray-200"
              >
                {[10, 20, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <ChevronsUpDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[#09090B] opacity-50 pointer-events-none" />
            </div>
          </div>

          {/* Page info */}
          <div className="text-sm font-medium text-[#09090B]">
            Page {page} of {totalPages || 1}
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(1)}
              disabled={page <= 1}
              className="flex items-center justify-center w-8 h-8 bg-white border border-[#E4E4E7] rounded-md disabled:opacity-50 hover:bg-gray-50 disabled:hover:bg-white"
            >
              <ChevronsLeft className="h-4 w-4 text-[#09090B]" />
            </button>
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="flex items-center justify-center w-8 h-8 bg-white border border-[#E4E4E7] rounded-md disabled:opacity-50 hover:bg-gray-50 disabled:hover:bg-white"
            >
              <ChevronLeft className="h-4 w-4 text-[#09090B]" />
            </button>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="flex items-center justify-center w-8 h-8 bg-white border border-[#E4E4E7] rounded-md disabled:opacity-50 hover:bg-gray-50 disabled:hover:bg-white"
            >
              <ChevronRight className="h-4 w-4 text-[#09090B]" />
            </button>
            <button
              onClick={() => onPageChange(totalPages)}
              disabled={page >= totalPages}
              className="flex items-center justify-center w-8 h-8 bg-white border border-[#E4E4E7] rounded-md disabled:opacity-50 hover:bg-gray-50 disabled:hover:bg-white"
            >
              <ChevronsRight className="h-4 w-4 text-[#09090B]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
