import { ResourceLanguage } from 'i18next';
import common from '@/locales/ja/common.json';
import appUpdate from '@/locales/ja/components/layouts/appUpdate.json';
import confirmModal from '@/locales/ja/components/modals/confirmModal.json';
import settingModal from '@/locales/ja/components/modals/settingModal.json';
import ipcMessage from '@/locales/ja/messages/ipcMessage.json';
import validateMessage from '@/locales/ja/messages/validateMessage.json';
import bucketPage from '@/locales/ja/pages/s3/bucket/page.json';
import bucketDetailDrawer from '@/locales/ja/pages/s3/bucketDetailDrawer.json';
import bucketPicker from '@/locales/ja/pages/s3/components/bucketPicker.json';
import inputs from '@/locales/ja/pages/s3/components/inputs.json';
import connectionProfiles from '@/locales/ja/pages/s3/connectionProfiles.json';
import bucketPolicyModal from '@/locales/ja/pages/s3/modals/bucketPolicyModal.json';
import connectModal from '@/locales/ja/pages/s3/modals/connectModal.json';
import createBucketModal from '@/locales/ja/pages/s3/modals/createBucketModal.json';
import credentialExpiring from '@/locales/ja/pages/s3/modals/credentialExpiring.json';
import deleteBucketModal from '@/locales/ja/pages/s3/modals/deleteBucketModal.json';
import deleteConfirmModal from '@/locales/ja/pages/s3/modals/deleteConfirmModal.json';
import deleteResultModal from '@/locales/ja/pages/s3/modals/deleteResultModal.json';
import exportProfileModal from '@/locales/ja/pages/s3/modals/exportProfileModal.json';
import historyModal from '@/locales/ja/pages/s3/modals/historyModal.json';
import importPasswordModal from '@/locales/ja/pages/s3/modals/importPasswordModal.json';
import uploadLimitModal from '@/locales/ja/pages/s3/modals/uploadLimitModal.json';
import uploadPickerModal from '@/locales/ja/pages/s3/modals/uploadPickerModal.json';
import objectPage from '@/locales/ja/pages/s3/object/page.json';
import objectDetailDrawer from '@/locales/ja/pages/s3/objectDetailDrawer.json';
import tabLayout from '@/locales/ja/pages/s3/tabLayout.json';
import downloaderWindow from '@/locales/ja/pages/s3/transfer/downloaderWindow.json';
import uploaderWindow from '@/locales/ja/pages/s3/transfer/uploaderWindow.json';
import dbProfileModal from '@/locales/ja/pages/sql/modals/dbProfileModal.json';
import sqlNavbar from '@/locales/ja/pages/sql/sqlNavbar.json';
import sqlTab from '@/locales/ja/pages/sql/sqlTab.json';

const japaneseResource: ResourceLanguage = {
  common: common,
  ipcMessage: ipcMessage,
  validateMessage: validateMessage,
  connectModal: connectModal,
  dbProfileModal: dbProfileModal,
  credentialExpiring: credentialExpiring,
  confirmModal: confirmModal,
  bucketPolicyModal: bucketPolicyModal,
  createBucketModal: createBucketModal,
  deleteBucketModal: deleteBucketModal,
  deleteConfirmModal: deleteConfirmModal,
  deleteResultModal: deleteResultModal,
  exportProfileModal: exportProfileModal,
  historyModal: historyModal,
  importPasswordModal: importPasswordModal,
  settingModal: settingModal,
  uploadLimitModal: uploadLimitModal,
  uploadPickerModal: uploadPickerModal,
  appUpdate: appUpdate,
  bucketPicker: bucketPicker,
  connectionProfiles: connectionProfiles,
  bucket: {
    page: bucketPage,
  },
  object: {
    page: objectPage,
  },
  inputs: inputs,
  downloaderWindow: downloaderWindow,
  bucketDetailDrawer: bucketDetailDrawer,
  objectDetailDrawer: objectDetailDrawer,
  tabLayout: tabLayout,
  sqlNavbar: sqlNavbar,
  sqlTab: sqlTab,
  uploaderWindow: uploaderWindow,
};
export default japaneseResource;
