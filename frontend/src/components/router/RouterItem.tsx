import { lazy, ReactNode } from 'react';
import { RouteObject } from 'react-router-dom';

const TabPage = lazy(() => import('@/pages/tab/TabPage'));

type IRouterItem = RouteObject & {
  page: ReactNode;
  prefix: string;
  path: string;
};
const RouterItems: Array<IRouterItem> = [
  {
    page: <TabPage />,
    prefix: '',
    path: '/',
  },
];
export default RouterItems;
