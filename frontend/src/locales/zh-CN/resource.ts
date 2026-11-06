import { ResourceLanguage } from 'i18next';
import common from '@/locales/zh-CN/common.json';
import bucketPicker from '@/locales/zh-CN/components/inputs/bucketPicker.json';
import inputs from '@/locales/zh-CN/components/inputs/inputs.json';
import appUpdate from '@/locales/zh-CN/components/layouts/appUpdate.json';
import connectionProfiles from '@/locales/zh-CN/components/layouts/navbar/connectionProfiles.json';
import downloaderWindow from '@/locales/zh-CN/components/layouts/transfer/downloaderWindow.json';
import uploaderWindow from '@/locales/zh-CN/components/layouts/transfer/uploaderWindow.json';
import bucketPolicyModal from '@/locales/zh-CN/components/modals/bucketPolicyModal.json';
import confirmModal from '@/locales/zh-CN/components/modals/confirmModal.json';
import connectModal from '@/locales/zh-CN/components/modals/connectModal.json';
import createBucketModal from '@/locales/zh-CN/components/modals/createBucketModal.json';
import credentialExpiring from '@/locales/zh-CN/components/modals/credentialExpiring.json';
import deleteBucketModal from '@/locales/zh-CN/components/modals/deleteBucketModal.json';
import deleteConfirmModal from '@/locales/zh-CN/components/modals/deleteConfirmModal.json';
import deleteResultModal from '@/locales/zh-CN/components/modals/deleteResultModal.json';
import historyModal from '@/locales/zh-CN/components/modals/historyModal.json';
import settingModal from '@/locales/zh-CN/components/modals/settingModal.json';
import uploadLimitModal from '@/locales/zh-CN/components/modals/uploadLimitModal.json';
import uploadPickerModal from '@/locales/zh-CN/components/modals/uploadPickerModal.json';
import ipcMessage from '@/locales/zh-CN/messages/ipcMessage.json';
import validateMessage from '@/locales/zh-CN/messages/validateMessage.json';
import bucketPage from '@/locales/zh-CN/pages/tab/bucket/page.json';
import bucketDetailDrawer from '@/locales/zh-CN/pages/tab/bucketDetailDrawer.json';
import objectPage from '@/locales/zh-CN/pages/tab/object/page.json';
import objectDetailDrawer from '@/locales/zh-CN/pages/tab/objectDetailDrawer.json';
import tabLayout from '@/locales/zh-CN/pages/tab/tabLayout.json';

const simplifiedChineseResource: ResourceLanguage = {
  common: common,
  ipcMessage: ipcMessage,
  validateMessage: validateMessage,
  connectModal: connectModal,
  credentialExpiring: credentialExpiring,
  confirmModal: confirmModal,
  bucketPolicyModal: bucketPolicyModal,
  createBucketModal: createBucketModal,
  deleteBucketModal: deleteBucketModal,
  deleteConfirmModal: deleteConfirmModal,
  deleteResultModal: deleteResultModal,
  historyModal: historyModal,
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
  uploaderWindow: uploaderWindow,
};
export default simplifiedChineseResource;
