export enum DocumentStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  FINISHED = 'finished',
  FAILED = 'failed',
}

export interface DocumentData {
  documentId: string;
  fileName: string;
  size: number;
  status: DocumentStatus;
  mimetype: string;
}

export interface UsersData {
  userName: string;
  password: string;
}
