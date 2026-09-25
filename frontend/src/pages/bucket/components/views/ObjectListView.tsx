import { Text } from '@mantine/core';
import { GetListObject } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionProfileOutput, ListObjectOutput } from '@wails/S3Browser/models';
import { useEffect, useMemo, useState } from 'react';
import { callIPC } from '@/common/utils/ipcUtils';

type ObjectListViewProps = {
  profile?: ConnectionProfileOutput | null;
  bucket?: string;
};

type ObjectDatas = ListObjectOutput & {
  connectionId: string;
  bucket: string;
  profileName?: string;
};

function ObjectListView(props: ObjectListViewProps) {
  const { bucket, profile } = props;

  const [objectDatas, setObjectDatas] = useState<ObjectDatas>({
    objectList: [],
    nextCursor: '',
    connectionId: '',
    bucket: '',
  });

  const profileId = profile?.id;
  const profileName = profile?.name;

  useEffect(() => {
    if (!profileId || !bucket) return;

    let cancelled = false;
    callIPC(GetListObject, [
      { connectionId: profileId, profileName, bucket: bucket, prefix: '', nextCursor: '', limit: 10 },
    ]).then(output => {
      if (output && !cancelled) {
        setObjectDatas({ ...output, connectionId: profileId, profileName, bucket });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [profileId, profileName, bucket]);

  const objectDetail = useMemo(() => {
    const objectList = profileId && objectDatas?.connectionId === profileId ? objectDatas.objectList : [];
    return (objectList || []).map((item, idx) => <Text key={`${item.key}-${idx}`}>{item.name}</Text>);
  }, [profileId, objectDatas.objectList, objectDatas.connectionId]);

  return <>{objectDetail}</>;
}
export default ObjectListView;
