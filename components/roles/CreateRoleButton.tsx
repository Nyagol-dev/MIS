'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { RoleForm } from './RoleForm';

export function CreateRoleButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>Create Role</Button>
      <RoleForm isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
