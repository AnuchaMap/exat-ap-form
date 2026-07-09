sap.ui.define(
  [
    "sap/ui/core/UIComponent",
    "sap/ui/Device",
    "apmgtnsp/workflowuimodule/model/models",
    "sap/m/MessageBox",
    "sap/ui/core/BusyIndicator",
  ],
  function (UIComponent, Device, models, MessageBox, BusyIndicator) {
    "use strict";

    return UIComponent.extend("apmgtnsp.workflowuimodule.Component", {
      metadata: {
        manifest: "json",
      },

      init: function () {
        UIComponent.prototype.init.apply(this, arguments);
        this.getRouter().initialize();
        this.setModel(models.createDeviceModel(), "device");
        this.setTaskModels();

        var oContextModel = this.getModel("context");

        oContextModel.attachRequestCompleted(
          function () {
            // ✅ เปลี่ยนจาก RequestStatus มาใช้ IsAllApproved / IsReject
            var bIsAllApproved = oContextModel.getProperty("/IsAllApproved");
            var bIsReject      = oContextModel.getProperty("/IsReject");
            var bIsPending     = !bIsAllApproved && !bIsReject;

            if (bIsPending) {
              // ยังรออนุมัติ → แสดงปุ่ม Approve + Reject
              this.getInboxAPI().addAction(
                { action: "reject", label: "Reject", type: "reject" },
                function () { this.completeTask(false, "reject"); },
                this,
              );
              this.getInboxAPI().addAction(
                { action: "approve", label: "Approve", type: "accept" },
                function () { this.completeTask(true, "approve"); },
                this,
              );
            } else {
              // ผ่านกระบวนการแล้ว → แสดงแค่ปุ่ม Close
              this.getInboxAPI().addAction(
                { action: "approve", label: "Close", type: "reject" },
                function () { this.completeTask(true, "approve"); },
                this,
              );
            }
          }.bind(this),
        );
      },

      setTaskModels: function () {
        var startupParameters = this.getComponentData().startupParameters;
        this.setModel(startupParameters.taskModel, "task");

        var taskContextModel = new sap.ui.model.json.JSONModel(
          this._getTaskInstancesBaseURL() + "/context",
        );
        this.setModel(taskContextModel, "context");
      },

      _getTaskInstancesBaseURL: function () {
        return (
          this._getWorkflowRuntimeBaseURL() +
          "/task-instances/" +
          this.getTaskInstanceID()
        );
      },

      _getWorkflowRuntimeBaseURL: function () {
        var ui5CloudService = this.getManifestEntry("/sap.cloud/service").replaceAll(".", "");
        var ui5ApplicationName = this.getManifestEntry("/sap.app/id").replaceAll(".", "");
        return "/" + ui5CloudService + "." + ui5ApplicationName + "/api/public/workflow/rest/v1";
      },

      getTaskInstanceID: function () {
        return this.getModel("task").getData().InstanceID;
      },

      getInboxAPI: function () {
        return this.getComponentData().startupParameters.inboxAPI;
      },

      completeTask: function (approvalStatus, outcomeId) {
        this.getModel("context").setProperty("/approved", approvalStatus);
        // Log action initiation and current context for debugging
        try {
          var dbgContext = jQuery.extend(true, {}, this.getModel("context").getData());
          jQuery.sap.log.info("completeTask called. approvalStatus=" + approvalStatus + ", outcomeId=" + outcomeId + ", context=" + JSON.stringify(dbgContext));
        } catch (e) {
          jQuery.sap.log.error("Failed to stringify context for debug", e);
        }

        this.getInboxAPI().disableAction("approve");
        this.getInboxAPI().disableAction("reject");
        BusyIndicator.show(0);
        this._patchTaskInstance(outcomeId).always(function () {
          BusyIndicator.hide();
        });
      },

      _patchTaskInstance: function (outcomeId) {
        var context = jQuery.extend(true, {}, this.getModel("context").getData());
        var deferred = jQuery.Deferred();
        var hasCompleted = false;

        // ✅ เปลี่ยนจาก RequestStatus มาใช้ IsAllApproved / IsReject
        var bIsAllApproved = context.IsAllApproved;
        var bIsReject      = context.IsReject;
        var bIsPending     = !bIsAllApproved && !bIsReject;

        if (!bIsPending) {
          context.ApproverComment    = context.ApproverComment    || "";
          context.SignatureUsername  = context.SignatureUsername  || "";
          context.SignaturePassword  = context.SignaturePassword  || "";
          context.SignatureToken     = context.SignatureToken     || "";
          context.IsClose            = true;
        } else {
          context.IsClose = false;
        }

        // Ensure required workflow output fields exist even if signature UI is disabled
        context.ApproverComment   = context.ApproverComment   || "";
        context.SignatureUsername = context.SignatureUsername || "";
        context.SignaturePassword = context.SignaturePassword || "";
        context.SignatureToken    = context.SignatureToken    || "";

        var payload = {
          status: "COMPLETED",
          context: { ...context, comment: context.comment || "" },
          decision: outcomeId,
        };

        // Log outgoing request details (URL + payload). Token is logged masked later.
        try {
          jQuery.sap.log.info("Sending PATCH to " + this._getTaskInstancesBaseURL() + " payload=" + JSON.stringify(payload));
        } catch (e) {
          jQuery.sap.log.error("Failed to stringify payload for debug", e);
        }

        this._fetchToken()
          .then(function (token) {
            var masked = token ? ("" + token).substring(0, 6) + "..." : "(none)";
            jQuery.sap.log.info("Fetched X-CSRF-Token: " + masked);
            return jQuery.ajax({
              url: this._getTaskInstancesBaseURL(),
              method: "PATCH",
              contentType: "application/json",
              async: true,
              data: JSON.stringify(payload),
              headers: { "X-CSRF-Token": token || "" },
            });
          }.bind(this))
          .done(function () {
            hasCompleted = true;
            this._refreshTaskList();
            deferred.resolve();
          }.bind(this))
          .fail(function (jqXHR) {
            hasCompleted = true;
            jQuery.sap.log.error("Task completion failed", jqXHR);
            MessageBox.error("ไม่สามารถส่งผลการอนุมัติได้ กรุณาลองใหม่อีกครั้ง");
            this._restoreInboxActions();
            deferred.reject(jqXHR);
          }.bind(this));

        window.setTimeout(function () {
          if (!hasCompleted) {
            jQuery.sap.log.error("Task completion timed out");
            MessageBox.error("คำขออนุมัติใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง");
            this._restoreInboxActions();
            deferred.reject(new Error("timeout"));
          }
        }.bind(this), 15000);

        return deferred.promise();
      },

      _restoreInboxActions: function () {
        if (!this.getInboxAPI()) {
          return;
        }

        this.getInboxAPI().enableAction("approve");
        this.getInboxAPI().enableAction("reject");
      },

      _fetchToken: function () {
        var deferred = jQuery.Deferred();

        jQuery.ajax({
          url: this._getWorkflowRuntimeBaseURL() + "/xsrf-token",
          method: "GET",
          async: true,
          headers: { "X-CSRF-Token": "Fetch" },
          success: function (data, textStatus, jqXHR) {
            var fetchedToken = jqXHR.getResponseHeader("X-CSRF-Token") || "";
            try {
              var masked = fetchedToken ? ("" + fetchedToken).substring(0, 6) + "..." : "(none)";
              jQuery.sap.log.info("_fetchToken success, token=" + masked);
            } catch (e) {
              jQuery.sap.log.error("_fetchToken: failed to log token", e);
            }
            deferred.resolve(fetchedToken);
          },
          error: function (jqXHR) {
            jQuery.sap.log.error("Failed to fetch workflow CSRF token", jqXHR);
            deferred.reject(jqXHR);
          },
        });

        return deferred.promise();
      },

      _refreshTaskList: function () {
        this.getInboxAPI().updateTask("NA", this.getTaskInstanceID());
      },
    });
  },
);