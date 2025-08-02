# Firebase Technical Specification

## 1. UI Changes

### Google Sign-In Button
The Google Sign-In button already exists in the v2/index.html file but needs to be repositioned below the local sign-in form. The button has the following attributes:
- `data-action="google-sign-in"`
- Should be placed after the local sign-in button but before the back button

## 2. Data Storage Implementation

### Firebase Integration Points

#### saveTasks Function
Current implementation saves tasks to localStorage. New implementation should:
1. Check if user is authenticated with Firebase
2. If authenticated, save tasks to Firestore at `users/{uid}/app/state` (updating the tasks field)
3. If Firebase operation fails or user is not authenticated, fallback to localStorage
4. Maintain the existing localStorage structure for compatibility

#### savePlaylistsToUserData Function
Current implementation saves playlists to localStorage. New implementation should:
1. Check if user is authenticated with Firebase
2. If authenticated, save playlists to Firestore at `users/{uid}/app/state` (updating the playlists field)
3. If Firebase operation fails or user is not authenticated, fallback to localStorage
4. Maintain the existing localStorage structure for compatibility

#### loadSavedState