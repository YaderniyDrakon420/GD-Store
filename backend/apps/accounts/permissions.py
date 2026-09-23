from rest_framework import permissions


class IsOwnerOrReadOnly(permissions.BasePermission):
    def has_object_permission(self, request, _view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        return obj == request.user


class IsFriendshipParticipant(permissions.BasePermission):
    def has_object_permission(self, request, _view, obj):
        return request.user in (obj.from_user, obj.to_user)


class IsRecipient(permissions.BasePermission):
    def has_object_permission(self, request, _view, obj):
        return obj.to_user == request.user