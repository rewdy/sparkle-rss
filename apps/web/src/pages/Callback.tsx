import { Alert, Center, Loader } from '@mantine/core';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { handleCallback } from '../lib/auth';

export function Callback(): ReactElement {
  const [, navigate] = useLocation();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    handleCallback()
      .then(() => navigate('/', { replace: true }))
      .catch((e: Error) => setError(e.message));
  }, [navigate]);

  if (error) {
    return (
      <Center mih="100vh" p="md">
        <Alert title="sign-in failed" color="red" w={420}>
          {error}
        </Alert>
      </Center>
    );
  }
  return (
    <Center mih="100vh">
      <Loader size="sm" type="dots" />
    </Center>
  );
}
