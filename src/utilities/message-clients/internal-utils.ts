export function evtCleanup<T>(evt: any): T {
  delete evt._forwardedAt;
  delete evt._publishedAt;
  delete evt._senderId;
  return evt as T;
}
