sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/ui/model/json/JSONModel",
  ],
  function (Controller, MessageToast, JSONModel) {
    "use strict";

    return Controller.extend("apmgtnsp.workflowuimodule.controller.App", {

      // ─── Init ────────────────────────────────────────────────────────────
      onInit: function () {
        var oComponent = this.getOwnerComponent();
        if (oComponent) {
          oComponent.attachEvent(
            "modelContextChange",
            this._onContextModelChange,
            this,
          );
        }

        var oViewModel = new JSONModel({
          Attachments: [],
          iframeContent: "<div>กำลังโหลดเอกสาร...</div>",
        });
        this.getView().setModel(oViewModel, "view");

        this.onLoginChange();

        this._iPdfRetryCount = 0;
        this._iDmsRetryCount = 0;

        this.onPreviewPdf();
      },

      // ─── Status Style ─────────────────────────────────────────────────────
      _applyStatusStyle: function () {
        var oContextModel =
          this.getView().getModel("context") ||
          this.getOwnerComponent().getModel("context");

        if (!oContextModel) return;

        var wfType = oContextModel.getProperty("/WorkflowType");
        var bIsAllApproved = oContextModel.getProperty("/IsAllApproved");
        var bIsReject = oContextModel.getProperty("/IsReject");

        var oNestedView = this.byId("nested" + wfType);
        if (!oNestedView) return;

        var oText = oNestedView.byId("txtStatus");
        if (!oText) return;

        oText.removeStyleClass("pending");
        oText.removeStyleClass("approved");
        oText.removeStyleClass("rejected");

        if (bIsReject) {
          oText.addStyleClass("requestStatus");
          oText.addStyleClass("rejected");
        } else if (bIsAllApproved) {
          oText.addStyleClass("requestStatus");
          oText.addStyleClass("approved");
        } else {
          oText.addStyleClass("requestStatus");
          oText.addStyleClass("pending");
        }
      },

      // ─── Context Model Change ─────────────────────────────────────────────
      _onContextModelChange: function () {
        var oContextModel =
          this.getView().getModel("context") ||
          this.getOwnerComponent().getModel("context");

        if (oContextModel) {
          setTimeout(function () {
            this._iPdfRetryCount = 0;
            this._iDmsRetryCount = 0;

            this._loadDmsAttachmentsOnly();
            this.onPreviewPdf();
            this._updateInboxActions();
            this._applyStatusStyle();
            this._attachFileListEvent();
          }.bind(this), 1000);
        }
      },

      // ─── Attach File List Event ───────────────────────────────────────────
      _attachFileListEvent: function () {
        // fileList อยู่ใน main view โดยตรง ไม่ต้องผ่าน nested view
        var oList = this.byId("fileList");
        if (!oList) return;

        oList.attachItemPress(function (oEvent) {
          var oItem = oEvent.getParameter("listItem");
          var oContext = oItem.getBindingContext("view");
          var bIsDownloadable = oContext.getProperty("isDownloadable");
          var sFileUrl = oContext.getProperty("fileUrl");
        
          if (bIsDownloadable) {
            this._downloadFileById(
              oContext.getProperty("fileId"),
              oContext.getProperty("fileName")
            );
          } else {
            if (sFileUrl) {
              window.open(sFileUrl, "_blank");
            }
          }
        }.bind(this));
      },

      // ─── DMS Attachments ─────────────────────────────────────────────────
      _loadDmsAttachmentsOnly: function () {
        var oView = this.getView();
        var oViewModel = oView.getModel("view");
        var oContextModel =
          oView.getModel("context") ||
          this.getOwnerComponent().getModel("context");

        if (!oViewModel || !oContextModel) {
          this._retryDmsLoad("โมเดลระบบ UI ยังไม่พร้อม");
          return;
        }

        var sFolderId = oContextModel.getProperty("/FolderID");
        if (!sFolderId || sFolderId === "undefined") {
          this._retryDmsLoad("ยังไม่พบข้อมูล FolderID ใน Context");
          return;
        }

        oView.setBusy(true);
        var oConfig = this.getOwnerComponent().getManifestEntry("/sap.ui5/config");
        var sApiUrl = oConfig.dmsApiUrl.replace("{FOLDER_ID}", sFolderId);

        jQuery.ajax({
          url: sApiUrl,
          method: "GET",
          dataType: "json",
          success: function (oData) {
            oView.setBusy(false);
            var aApiAttachments = [];
            if (oData && oData.success && oData.items) {
              aApiAttachments = oData.items.map(function (oItem) {
                var sExt = (oItem.name || "").split(".").pop().toLowerCase();
                var bIsDownloadable = ["xlsx", "xls", "doc", "docx", "csv"].indexOf(sExt) !== -1;

                return {
                  fileName: oItem.name,
                  fileIcon: oItem.fileIcon,
                  fileUrl: oItem.previewUrl,
                  fileId: oItem.id,
                  isFolder: oItem.isFolder,
                  isDownloadable: bIsDownloadable,
                };
              });
              oViewModel.setProperty("/Attachments", aApiAttachments);
            } else {
              this._retryDmsLoad("ไม่พบคีย์ข้อมูลรายการไฟล์ย่อย (items)");
            }
          }.bind(this),
          error: function (oError) {
            oView.setBusy(false);
            jQuery.sap.log.error(oError);
            this._retryDmsLoad("เกิดข้อผิดพลาดจากเครือข่าย API (Network Error)");
          }.bind(this),
        });
      },

      _retryDmsLoad: function (sReason) {
        var oViewModel = this.getView().getModel("view");
        if (this._iDmsRetryCount < 5) {
          this._iDmsRetryCount++;
          setTimeout(this._loadDmsAttachmentsOnly.bind(this), 1500);
        } else {
          this.getView().setBusy(false);
          if (oViewModel) oViewModel.setProperty("/Attachments", []);
        }
      },

      // ─── Download File ────────────────────────────────────────────────────
      _downloadFileById: function (sFileId, sFileName) {
        var oView = this.getView();

        if (!sFileId) {
          MessageToast.show("ไม่พบ ID ของไฟล์");
          return;
        }

        oView.setBusy(true);
        var sBase64Url = "https://sbpa_helper.cfapps.ap10.hana.ondemand.com/api/dms/file/" + sFileId + "/base64";

        fetch(sBase64Url)
          .then(function (res) { return res.json(); })
          .then(function (oFileData) {
            oView.setBusy(false);

            if (!oFileData.success || !oFileData.base64Data) {
              MessageToast.show("ดึงข้อมูลไฟล์ไม่สำเร็จ");
              return;
            }

            var byteCharacters = window.atob(oFileData.base64Data);
            var byteArrays = [];
            for (var offset = 0; offset < byteCharacters.length; offset += 512) {
              var slice = byteCharacters.slice(offset, offset + 512);
              var byteNumbers = new Array(slice.length);
              for (var i = 0; i < slice.length; i++) {
                byteNumbers[i] = slice.charCodeAt(i);
              }
              byteArrays.push(new Uint8Array(byteNumbers));
            }

            var sExt = (sFileName || "").split(".").pop().toLowerCase();
            var mMimeTypes = {
              "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "xls":  "application/vnd.ms-excel",
              "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              "doc":  "application/msword",
              "csv":  "text/csv",
            };
            var sMimeType = mMimeTypes[sExt] || "application/octet-stream";

            var blob = new Blob(byteArrays, { type: sMimeType });
            var blobUrl = URL.createObjectURL(blob);

            var oLink = document.createElement("a");
            oLink.href = blobUrl;
            oLink.download = sFileName || "download";
            document.body.appendChild(oLink);
            oLink.click();
            document.body.removeChild(oLink);

            setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 1000);
            MessageToast.show("กำลังดาวน์โหลด: " + sFileName);
          }.bind(this))
          .catch(function (err) {
            oView.setBusy(false);
            jQuery.sap.log.error("Download error:", err);
            MessageToast.show("เกิดข้อผิดพลาดในการดาวน์โหลด");
          }.bind(this));
      },

      // ─── PDF Preview ──────────────────────────────────────────────────────
      onPreviewPdf: function () {
        var oView = this.getView();
        var oContextModel =
          oView.getModel("context") ||
          this.getOwnerComponent().getModel("context");

        if (!oContextModel) {
          this._retryPdfPreview("Context Model ยังทำงานไม่เสร็จ");
          return;
        }

        var sPreviewFolderId = oContextModel.getProperty("/PreviewFolderID");

        if (!sPreviewFolderId || sPreviewFolderId === "undefined") {
          this._retryPdfPreview("ยังไม่พบข้อมูล PreviewFolderID บน Context");
          return;
        }

        var oConfig = this.getOwnerComponent().getManifestEntry("/sap.ui5/config");
        var sApiUrl = oConfig.dmsApiUrl.replace("{FOLDER_ID}", sPreviewFolderId);

        oView.setBusy(true);

        jQuery.ajax({
          url: sApiUrl,
          method: "GET",
          dataType: "json",
          success: function (oData) {
            if (oData && oData.success && oData.items && oData.items.length > 0) {
              var sFileId = oData.items[0].id;
              var sBase64Url = "https://sbpa_helper.cfapps.ap10.hana.ondemand.com/api/dms/file/" + sFileId + "/base64";

              fetch(sBase64Url)
                .then(function (res) { return res.json(); })
                .then(function (oFileData) {
                  oView.setBusy(false);
                  if (oFileData.success && oFileData.base64Data) {
                    this.loadPdf(oFileData.base64Data);
                  } else {
                    this._retryPdfPreview("ดึงข้อมูลรหัส Base64 ของไฟล์ไม่สำเร็จ");
                  }
                }.bind(this))
                .catch(function (err) {
                  oView.setBusy(false);
                  jQuery.sap.log.error("Error fetching preview base64:", err);
                  this._retryPdfPreview("เกิดข้อผิดพลาด (Catch) ในส่วนการดึงข้อมูล Base64");
                }.bind(this));
            } else {
              this._retryPdfPreview("ไม่พบไฟล์ใดๆ ภายในโฟลเดอร์สำหรับทำ Preview");
            }
          }.bind(this),
          error: function (oError) {
            oView.setBusy(false);
            jQuery.sap.log.error(oError);
            this._retryPdfPreview("เกิดข้อผิดพลาดทางเครือข่ายของฝั่ง API");
          }.bind(this),
        });
      },

      _retryPdfPreview: function (sReason) {
        var oViewModel = this.getView().getModel("view");
        if (this._iPdfRetryCount < 5) {
          this._iPdfRetryCount++;
          if (oViewModel) {
            oViewModel.setProperty("/iframeContent", "<div>กำลังพยายามโหลดเอกสารใหม่... (ครั้งที่ " + this._iPdfRetryCount + "/5)</div>");
          }
          setTimeout(this.onPreviewPdf.bind(this), 2000);
        } else {
          this.getView().setBusy(false);
          if (oViewModel) {
            oViewModel.setProperty("/iframeContent", "<div>ไม่พบเอกสาร Preview หรือโหลดเอกสารไม่สำเร็จเกิน 5 ครั้ง</div>");
          }
        }
      },

      loadPdf: function (sBase64) {
        var byteCharacters = window.atob(sBase64);
        var byteArrays = [];
        for (var offset = 0; offset < byteCharacters.length; offset += 512) {
          var slice = byteCharacters.slice(offset, offset + 512);
          var byteNumbers = new Array(slice.length);
          for (var i = 0; i < slice.length; i++) {
            byteNumbers[i] = slice.charCodeAt(i);
          }
          byteArrays.push(new Uint8Array(byteNumbers));
        }

        var blob = new Blob(byteArrays, { type: "application/pdf" });
        var blobUrl = URL.createObjectURL(blob);
        var sIframeHtml =
          '<iframe src="' + blobUrl +
          '" width="100%" height="595px" style="border: none; border-radius: 4px; display: block; max-width: 100%;"></iframe>';

        this.getView().getModel("view").setProperty("/iframeContent", sIframeHtml);
      },

      // ─── Login ────────────────────────────────────────────────────────────
      onLoginChange: function () {
        var oView = this.getView();
        var sUsername = oView.byId("usernameInput")
          ? oView.byId("usernameInput").getValue() : "";
        var sPassword = oView.byId("passwordInput")
          ? oView.byId("passwordInput").getValue() : "";

        var oLoginButton = oView.byId("loginButton");
        if (oLoginButton) {
          oLoginButton.setEnabled(
            sUsername.trim().length > 0 && sPassword.trim().length > 0,
          );
        }
      },

      // onLoginPress: function () {
      //   var oView = this.getView();
      //   var sUsername = oView.byId("usernameInput").getValue();
      //   var sPassword = oView.byId("passwordInput").getValue();

      //   if (!sUsername || !sPassword) {
      //     MessageToast.show("กรุณากรอก Username และ Password ให้ครบถ้วน");
      //     return;
      //   }

      //   var oContextModel = oView.getModel("context");
      //   oView.setBusy(true);

      //   var oConfig = this.getOwnerComponent().getManifestEntry("/sap.ui5/config");

      //   jQuery.ajax({
      //     url: oConfig.tokenApiUrl,
      //     method: "POST",
      //     contentType: "application/json",
      //     data: JSON.stringify({ username: sUsername, password: sPassword, ref_1: "", ref_2: "" }),
      //     success: function (oData) {
      //       oView.setBusy(false);
      //       var oSigner =
      //         oData &&
      //         oData.result &&
      //         oData.result.details &&
      //         oData.result.details.signer &&
      //         oData.result.details.signer[0];

      //       if (oSigner && (oSigner.status === "S" || oSigner.statusCode === "200")) {
      //         if (oContextModel) {
      //           oContextModel.setProperty("/SignatureUsername", sUsername);
      //           oContextModel.setProperty("/SignatureToken", oSigner.token);
      //           oContextModel.refresh(true);
      //         }
      //         this._updateInboxActions();
      //         MessageToast.show("เข้าสู่ระบบสำเร็จ! ได้รับ Token เรียบร้อยแล้ว");
      //       } else {
      //         MessageToast.show(
      //           "ไม่สามารถรับ Token ได้: " +
      //           ((oSigner && oSigner.message) || "ข้อมูลไม่ถูกต้อง"),
      //         );
      //       }
      //     }.bind(this),
      //     error: function (jqXHR) {
      //       oView.setBusy(false);
      //       jQuery.sap.log.error("API Token Error:", jqXHR);
      //       var bIsTestMode = oContextModel && oContextModel.getProperty("/IsTestMode") === true;
      //       if (bIsTestMode) {
      //         MessageToast.show("Error API แต่ระบบทำการจำลอง (Mock) Token ให้ชั่วคราว");

      //         if (oContextModel) {
      //           oContextModel.setProperty("/SignatureUsername", sUsername);
      //           oContextModel.setProperty(
      //             "/SignatureToken",
      //             "MOCK_TOKEN_" + Math.random().toString(36).substr(2, 9).toUpperCase(),
      //           );
      //           oContextModel.refresh(true);
      //         }
      //         this._updateInboxActions();
      //       } else {
      //         MessageToast.show(
      //           "ไม่สามารถรับ Token ได้: เกิดข้อผิดพลาดจาก API กรุณาลองใหม่อีกครั้ง",
      //         );
      //       }
      //     }.bind(this),
      //   });
      // },

      onLoginPress: function () {
        var oView = this.getView();
        var sUsername = oView.byId("usernameInput").getValue();
        var sPassword = oView.byId("passwordInput").getValue();

        if (!sUsername || !sPassword) {
          MessageToast.show("กรุณากรอก Username และ Password ให้ครบถ้วน");
          return;
        }
      
        this._iTokenRetryCount = 0;
        this._callTokenApi(sUsername, sPassword);
      },

      // ─── Token API Call ───────────────────────────────────────────────────
      _callTokenApi: function (sUsername, sPassword) {
        var oView = this.getView();
        var oContextModel = oView.getModel("context");
        oView.setBusy(true);
      
        var oConfig = this.getOwnerComponent().getManifestEntry("/sap.ui5/config");
      
        jQuery.ajax({
          url: oConfig.tokenApiUrl,
          method: "POST",
          contentType: "application/json",
          data: JSON.stringify({ username: sUsername, password: sPassword, ref_1: "", ref_2: "" }),
          success: function (oData) {
            oView.setBusy(false);
            var oSigner =
              oData &&
              oData.result &&
              oData.result.details &&
              oData.result.details.signer &&
              oData.result.details.signer[0];
          
            if (oSigner && (oSigner.status === "S" || oSigner.statusCode === "200")) {
              if (oContextModel) {
                oContextModel.setProperty("/SignatureUsername", sUsername);
                oContextModel.setProperty("/SignatureToken", oSigner.token);
                oContextModel.refresh(true);
              }
              this._updateInboxActions();
              MessageToast.show("เข้าสู่ระบบสำเร็จ! ได้รับ Token เรียบร้อยแล้ว");
            } else {
              // ได้รับ response แต่ signer ไม่สำเร็จ ให้ retry เช่นกัน
              this._retryTokenLogin(sUsername, sPassword,
                "ไม่สามารถรับ Token ได้: " + ((oSigner && oSigner.message) || "ข้อมูลไม่ถูกต้อง"));
            }
          }.bind(this),
          error: function (jqXHR) {
            oView.setBusy(false);
            jQuery.sap.log.error("API Token Error:", jqXHR);
            this._retryTokenLogin(sUsername, sPassword, "เกิดข้อผิดพลาดจากเครือข่าย API");
          }.bind(this),
        });
      },
      
      _retryTokenLogin: function (sUsername, sPassword, sReason) {
        var oView = this.getView();
        var oContextModel = oView.getModel("context");
      
        if (this._iTokenRetryCount < 5) {
          this._iTokenRetryCount++;
          MessageToast.show(
            "กำลังลองรับ Token ใหม่... (ครั้งที่ " + this._iTokenRetryCount + "/5)"
          );
          setTimeout(function () {
            this._callTokenApi(sUsername, sPassword);
          }.bind(this), 2000);
        } else {
          // ลองครบ 5 ครั้งแล้วไม่สำเร็จ
          var bIsTestMode = oContextModel && oContextModel.getProperty("/IsTestMode") === true;
        
          if (bIsTestMode) {
            MessageToast.show("Error API ครบ 5 ครั้ง แต่ระบบทำการจำลอง (Mock) Token ให้ชั่วคราว");
          
            if (oContextModel) {
              oContextModel.setProperty("/SignatureUsername", sUsername);
              oContextModel.setProperty(
                "/SignatureToken",
                "MOCK_TOKEN_" + Math.random().toString(36).substr(2, 9).toUpperCase(),
              );
              oContextModel.refresh(true);
            }
            this._updateInboxActions();
          } else {
            MessageToast.show(
              "ไม่สามารถรับ Token ได้: เกิดข้อผิดพลาดจาก API ครบ 5 ครั้ง กรุณาลองใหม่อีกครั้ง",
            );
          }
        }
      },

      // ─── Inbox Actions ────────────────────────────────────────────────────
      _updateInboxActions: function () {
        var oComponentData = this.getOwnerComponent().getComponentData();
        if (
          !oComponentData ||
          !oComponentData.startupParameters ||
          !oComponentData.startupParameters.inboxAPI
        ) return;

        var oInboxAPI = oComponentData.startupParameters.inboxAPI;
        var oContextModel =
          this.getView().getModel("context") ||
          this.getOwnerComponent().getModel("context");

        var sToken = oContextModel.getProperty("/SignatureToken") || "";
        var bIsAllApproved = oContextModel.getProperty("/IsAllApproved");
        var bIsReject = oContextModel.getProperty("/IsReject");
        var bIsClose = oContextModel.getProperty("/IsClose");

        if ((sToken.trim().length > 0 && !bIsAllApproved && !bIsReject) || bIsClose) {
          oInboxAPI.enableAction("approve");
          oInboxAPI.enableAction("reject");
        } else {
          oInboxAPI.disableAction("approve");
          oInboxAPI.disableAction("reject");
        }

        oContextModel.refresh(true);
      },

      onCommentLiveChange: function () {
        this._updateInboxActions();
      },

      // ─── Path Buttons ────────────────────────────────────────────────────
      onCorrectPathClick: function () {
        MessageToast.show("Correct Path Clicked");
      },

      onIncorrectPathClick: function () {
        MessageToast.show("Incorrect Path Clicked");
      },
    });
  },
);