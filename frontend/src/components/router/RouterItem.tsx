import { lazy, ReactNode } from 'react';
import { RouteObject } from 'react-router-dom';

const BucketPage = lazy(() => import('@/pages/bucket/Page'));

export type IRouterItem = RouteObject & {
  page: ReactNode;
  prefix: string;
  path: string;
};
const RouterItems: Array<IRouterItem> = [
  {
    page: <BucketPage />,
    prefix: '',
    path: '/',
  },
];
export default RouterItems;
